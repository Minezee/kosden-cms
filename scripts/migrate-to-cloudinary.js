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

async function migrateImages() {
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

        // Buat mapping berdasarkan nama file
        const fileMapping = {};
        physicalFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            fileMapping[fileName] = filePath;
        });

        for (const file of dbFiles) {
            if (file.provider === 'local') {
                console.log(`Migrating: ${file.name}`);

                try {
                    // Cari file berdasarkan nama
                    const fileName = path.basename(file.url);
                    const localPath = fileMapping[fileName];

                    if (!localPath) {
                        console.log(`❌ File not found: ${fileName}`);
                        continue;
                    }

                    console.log(`📁 Found at: ${localPath}`);

                    // Upload ke Cloudinary
                    const uploadResult = await cloudinary.uploader.upload(localPath, {
                        public_id: file.hash,
                        folder: 'strapi-uploads',
                        resource_type: 'auto',
                    });

                    // Update database
                    await strapi.entityService.update('plugin::upload.file', file.id, {
                        data: {
                            url: uploadResult.secure_url,
                            provider: 'cloudinary',
                            provider_metadata: {
                                public_id: uploadResult.public_id,
                                resource_type: uploadResult.resource_type,
                            },
                        },
                    });

                    console.log(`✅ Migrated: ${file.name} -> ${uploadResult.secure_url}`);

                } catch (error) {
                    console.error(`❌ Error migrating ${file.name}:`, error.message);
                }
            }
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

migrateImages();