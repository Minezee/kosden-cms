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

// Function untuk mencari file dengan algoritma yang lebih smart
function findMatchingFile(dbFile, physicalFiles) {
    const { name, hash, url } = dbFile;

    // 1. Exact match berdasarkan URL
    const urlFileName = path.basename(url);
    let match = physicalFiles.find(f => path.basename(f) === urlFileName);
    if (match) return match;

    // 2. Match berdasarkan hash
    if (hash) {
        match = physicalFiles.find(f => path.basename(f).includes(hash));
        if (match) return match;
    }

    // 3. Match berdasarkan nama file dengan transformasi
    const cleanName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    match = physicalFiles.find(f => {
        const fileName = path.basename(f);
        return fileName.includes(cleanName) ||
            fileName.includes(name.replace(/\s+/g, '-')) ||
            fileName.includes(name.replace(/\s+/g, '_'));
    });
    if (match) return match;

    // 4. Fuzzy match berdasarkan nama (tanpa spasi dan karakter khusus)
    const searchPattern = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    match = physicalFiles.find(f => {
        const fileName = path.basename(f).toLowerCase().replace(/[^a-z0-9]/g, '');
        // Cari kecocokan minimal 60% dari nama
        const minLength = Math.min(searchPattern.length, fileName.length);
        const threshold = Math.max(3, Math.floor(minLength * 0.6));

        for (let i = 0; i <= searchPattern.length - threshold; i++) {
            const substr = searchPattern.substring(i, i + threshold);
            if (fileName.includes(substr)) return true;
        }
        return false;
    });
    if (match) return match;

    // 5. Last resort: cari berdasarkan ekstensi dan ukuran nama yang mirip
    const ext = path.extname(name);
    if (ext) {
        const sameExtFiles = physicalFiles.filter(f => path.extname(f) === ext);
        const baseName = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9]/g, '');

        match = sameExtFiles.find(f => {
            const fileBaseName = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9]/g, '');
            return fileBaseName.includes(baseName.substring(0, 5)) ||
                baseName.includes(fileBaseName.substring(0, 5));
        });
        if (match) return match;
    }

    return null;
}

async function smartMigration() {
    let strapi;

    try {
        // Inisialisasi Strapi
        const { createStrapi } = require('@strapi/strapi');
        strapi = await createStrapi().load();

        // Ambil semua file dari database
        const dbFiles = await strapi.entityService.findMany('plugin::upload.file');
        const localFiles = dbFiles.filter(f => f.provider === 'local');
        console.log(`Found ${localFiles.length} local files in database`);

        // Scan semua file fisik di folder uploads
        const uploadsPath = path.join(process.cwd(), 'public/uploads');
        const physicalFiles = getAllFiles(uploadsPath);
        console.log(`Found ${physicalFiles.length} physical files`);

        let successCount = 0;
        let failCount = 0;

        for (const file of localFiles) {
            console.log(`\nMigrating: ${file.name}`);

            try {
                const localPath = findMatchingFile(file, physicalFiles);

                if (!localPath) {
                    console.log(`❌ File not found for: ${file.name}`);
                    console.log(`   Hash: ${file.hash}`);
                    console.log(`   URL: ${file.url}`);
                    failCount++;
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
                successCount++;

            } catch (error) {
                console.error(`❌ Error migrating ${file.name}:`, error.message);
                failCount++;
            }
        }

        console.log('\n=== MIGRATION SUMMARY ===');
        console.log(`✅ Successfully migrated: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`📊 Total: ${localFiles.length}`);

        // Clear cache
        try {
            await strapi.cache.clear();
            console.log('✅ Cache cleared');
        } catch (error) {
            console.log('⚠️  Could not clear cache:', error.message);
        }

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

smartMigration();