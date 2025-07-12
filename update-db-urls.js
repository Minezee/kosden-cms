require('dotenv').config();
const path = require('path');
const { createStrapi } = require('@strapi/strapi');
const cloudinary = require('cloudinary').v2;

// Konfigurasi Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

async function updateReferences() {
    // Inisialisasi Strapi minimal tanpa server
    const strapi = await createStrapi({
        dir: process.cwd(),
        autoReload: false,
        serveAdminPanel: false
    });

    try {
        const db = strapi.db;
        const uploadService = strapi.plugin('upload').service('upload');

        // 1. Ambil semua file dari database
        const files = await db.query('plugin::upload.file').findMany();
        let updatedCount = 0;

        // 2. Update URL di database
        for (const file of files) {
            if (file.url && file.url.includes('/uploads/')) {
                const publicId = `strapi-uploads/${file.hash}${path.extname(file.url)}`;
                const newUrl = cloudinary.url(publicId, {
                    secure: true,
                    resource_type: file.mime.includes('video') ? 'video' : 'image'
                });

                await db.query('plugin::upload.file').update({
                    where: { id: file.id },
                    data: { url: newUrl }
                });

                console.log(`✅ Updated: ${file.url.substring(0, 50)}... → ${newUrl.substring(0, 50)}...`);
                updatedCount++;
            }
        }

        console.log(`\n🎉 Success! Updated ${updatedCount} files`);
    } finally {
        await strapi.destroy();
    }
}

updateReferences().catch(err => {
    console.error('💥 Error:', err);
    process.exit(1);
});