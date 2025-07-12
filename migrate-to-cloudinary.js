require('dotenv').config(); // Load environment variables
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// Verify Cloudinary configuration
if (!process.env.CLOUDINARY_NAME || !process.env.CLOUDINARY_KEY || !process.env.CLOUDINARY_SECRET) {
    throw new Error('Missing Cloudinary environment variables!');
}

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

const uploadsDir = path.join(__dirname, 'public', 'uploads');

// Create a rate-limited upload function
const uploadWithRetry = async (filePath, options, retries = 3) => {
    try {
        return await cloudinary.uploader.upload(filePath, options);
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying ${filePath} (${retries} attempts left)...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return uploadWithRetry(filePath, options, retries - 1);
        }
        throw error;
    }
};

async function migrateFiles(dir) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            await migrateFiles(fullPath);
        } else if (stat.isFile()) {
            try {
                // Skip non-image files if needed
                if (!['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(fullPath).toLowerCase())) {
                    console.log(`Skipping non-image file: ${fullPath}`);
                    continue;
                }

                const result = await uploadWithRetry(fullPath, {
                    folder: 'strapi-uploads',
                    resource_type: 'auto',
                    use_filename: true,
                    unique_filename: false
                });

                console.log(`Uploaded: ${fullPath} => ${result.secure_url}`);

                // Optional: Move instead of delete to keep backup
                const processedDir = path.join(dir, '_processed');
                if (!fs.existsSync(processedDir)) {
                    fs.mkdirSync(processedDir, { recursive: true });
                }
                fs.renameSync(fullPath, path.join(processedDir, item));

            } catch (error) {
                console.error(`Error uploading ${fullPath}:`, error.message);
                // Log failed files to a separate file
                fs.appendFileSync('failed_uploads.log', `${fullPath}\n`);
            }
        }
    }
}

// Verify uploads directory exists
if (!fs.existsSync(uploadsDir)) {
    console.error('Uploads directory not found:', uploadsDir);
    process.exit(1);
}

console.log('Starting migration...');
migrateFiles(uploadsDir)
    .then(() => console.log('Migration complete! Check failed_uploads.log for any errors.'))
    .catch(console.error);