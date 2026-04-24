/**
 * Storage helper — guarda imágenes localmente en public/imagenes/<folder>/
 * Si Cloudinary está configurado en .env, lo usa en su lugar.
 */
const path = require('path');
const fs   = require('fs');
require('dotenv').config();

const isCloudinary =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_API_KEY !== 'your_api_key' &&
  process.env.CLOUDINARY_ENABLED === 'true';

if (isCloudinary) {
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * @param {Buffer} buffer   - contenido del archivo
 * @param {string} folder   - subcarpeta: 'members' | 'trainers' | 'products' | 'index'
 * @param {string} filename - nombre original del archivo
 * @returns {Promise<string>} URL pública de la imagen
 */
const saveImage = async (buffer, folder = 'misc', filename = 'img') => {
  if (isCloudinary) {
    const cloudinary = require('cloudinary').v2;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `gym/${folder}`, resource_type: 'image' },
        (err, result) => err ? reject(err) : resolve(result.secure_url)
      );
      stream.end(buffer);
    });
  }

  // Almacenamiento local
  const ext      = path.extname(filename) || '.jpg';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const dir      = path.join(__dirname, '..', 'public', 'imagenes', folder);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, safeName), buffer);
  return `/imagenes/${folder}/${safeName}`;
};

/**
 * Elimina una imagen. Soporta tanto almacenamiento local como Cloudinary.
 * Para Cloudinary extrae el public_id de la URL segura.
 */
const deleteImage = async (url) => {
  if (!url) return;

  // Imagen local
  if (!url.startsWith('http')) {
    try {
      const filePath = path.join(__dirname, '..', 'public', url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
    return;
  }

  // Imagen en Cloudinary — extraer public_id de la URL
  // Formato: https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>.<ext>
  if (isCloudinary && url.includes('cloudinary.com')) {
    try {
      const cloudinary = require('cloudinary').v2;
      // Extraer todo lo que viene después de /upload/v<digits>/
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
      if (match) {
        const publicId = match[1]; // ej: "gym/productos/zpqe4s4jhhzilwreho2r"
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (_) {}
  }
};

module.exports = { saveImage, deleteImage, isCloudinary };
