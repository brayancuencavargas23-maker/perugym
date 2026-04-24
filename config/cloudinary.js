const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const isConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_API_KEY !== 'your_api_key';

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const uploadImage = async (fileBuffer, folder = 'gym') => {
  if (!isConfigured) {
    console.warn('Cloudinary no configurado — imagen ignorada');
    return null;
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
};

const deleteImage = async (publicId) => {
  if (!isConfigured) return;
  return cloudinary.uploader.destroy(publicId);
};

module.exports = { cloudinary, uploadImage, deleteImage, isConfigured };
