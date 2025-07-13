const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');

// Load environment variables
require('dotenv').config();

// Konfigurasi Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
});

// Function untuk scan semua file recursively
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

async function completeMigration() {
    let strapi;

    try {
        // Inisialisasi Strapi
        const { createStrapi } = require('@strapi/strapi');
        strapi = await createStrapi().load();

        // Ambil semua file dari database
        const dbFiles = await strapi.entityService.findMany('plugin::upload.file');
        console.log(`Found ${dbFiles.length} files in database`);

        // Scan semua file fisik di folder uploads
        const uploadsPath = path.join(process.cwd(), 'public/uploads');
        const physicalFiles = getAllFiles(uploadsPath);
        console.log(`Found ${physicalFiles.length} physical files`);

        // Buat mapping berdasarkan nama file dan hash
        const fileMapping = {};
        physicalFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            const fileNameWithoutExt = path.basename(filePath, path.extname(filePath));
            fileMapping[fileName] = filePath;
            fileMapping[fileNameWithoutExt] = filePath;
        });

        for (const file of dbFiles) {
            if (file.provider === 'local') {
                console.log(`Migrating: ${file.name}`);

                try {
                    // Cari file dengan berbagai cara
                    let localPath = null;

                    // 1. Cari berdasarkan URL path
                    const urlFileName = path.basename(file.url);
                    localPath = fileMapping[urlFileName];

                    // 2. Jika tidak ada, cari berdasarkan hash
                    if (!localPath && file.hash) {
                        const hashPattern = file.hash;
                        localPath = physicalFiles.find(filePath =>
                            path.basename(filePath).includes(hashPattern)
                        );
                    }

                    // 3. Jika masih tidak ada, cari berdasarkan nama file original
                    if (!localPath) {
                        const originalName = file.name.replace(/\.[^/.]+$/, ""); // remove extension
                        localPath = physicalFiles.find(filePath => {
                            const baseName = path.basename(filePath, path.extname(filePath));
                            return baseName.includes(originalName.replace(/\s+/g, '_')) ||
                                baseName.includes(originalName.replace(/\s+/g, '-')) ||
                                baseName.includes(originalName);
                        });
                    }

                    // 4. Fuzzy search berdasarkan nama
                    if (!localPath) {
                        const searchName = file.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                        localPath = physicalFiles.find(filePath => {
                            const fileName = path.basename(filePath).toLowerCase().replace(/[^a-z0-9]/g, '');
                            return fileName.includes(searchName.substring(0, 10)) ||
                                searchName.includes(fileName.substring(0, 10));
                        });
                    }

                    if (!localPath) {
                        console.log(`❌ File not found: ${urlFileName}`);
                        console.log(`   Original name: ${file.name}`);
                        console.log(`   Hash: ${file.hash}`);
                        console.log(`   URL: ${file.url}`);
                        continue;
                    }

                    console.log(`📁 Found at: ${localPath}`);

                    // Upload ke Cloudinary
                    const uploadResult = await cloudinary.uploader.upload(localPath, {
                        public_id: file.hash,
                        folder: 'strapi-uploads',
                        resource_type: 'auto',
                    });

                    // Update database dengan semua field yang diperlukan
                    await strapi.entityService.update('plugin::upload.file', file.id, {
                        data: {
                            url: uploadResult.secure_url,
                            provider: 'cloudinary',
                            provider_metadata: {
                                public_id: uploadResult.public_id,
                                resource_type: uploadResult.resource_type,
                            },
                            // Update formats jika ada (untuk thumbnails)
                            formats: file.formats ? Object.keys(file.formats).reduce((acc, key) => {
                                acc[key] = {
                                    ...file.formats[key],
                                    url: uploadResult.secure_url,
                                    provider_metadata: {
                                        public_id: uploadResult.public_id,
                                        resource_type: uploadResult.resource_type,
                                    }
                                };
                                return acc;
                            }, {}) : null
                        },
                    });

                    console.log(`✅ Migrated: ${file.name} -> ${uploadResult.secure_url}`);

                } catch (error) {
                    console.error(`❌ Error migrating ${file.name}:`, error.message);
                }
            }
        }

        console.log('\n=== CLEARING CACHE ===');

        // Clear Strapi cache
        try {
            await strapi.cache.clear();
            console.log('✅ Strapi cache cleared');
        } catch (error) {
            console.log('⚠️  Could not clear Strapi cache:', error.message);
        }

        console.log('Migration completed!');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        if (strapi) {
            await strapi.destroy();
        }
        process.exit(0);
    }
}

completeMigration();