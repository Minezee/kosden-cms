const { createStrapi } = require('@strapi/strapi');

async function checkMigrationStatus() {
    let strapi;

    try {
        strapi = await createStrapi().load();

        // Ambil semua file dari database
        const files = await strapi.entityService.findMany('plugin::upload.file');

        console.log('=== MIGRATION STATUS ===');
        console.log(`Total files: ${files.length}`);

        let localFiles = 0;
        let cloudinaryFiles = 0;

        files.forEach(file => {
            if (file.provider === 'local') {
                localFiles++;
                console.log(`❌ STILL LOCAL: ${file.name}`);
            } else if (file.provider === 'cloudinary') {
                cloudinaryFiles++;
                console.log(`✅ CLOUDINARY: ${file.name} -> ${file.url}`);
            }
        });

        console.log('\n=== SUMMARY ===');
        console.log(`Local files: ${localFiles}`);
        console.log(`Cloudinary files: ${cloudinaryFiles}`);

        if (localFiles === 0) {
            console.log('🎉 All files successfully migrated!');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (strapi) {
            await strapi.destroy();
        }
        process.exit(0);
    }
}

checkMigrationStatus();