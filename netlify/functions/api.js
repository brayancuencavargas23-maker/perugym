require('dotenv').config();
const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { initDB } = require('../../config/database');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));

// Inicializar DB una vez (Netlify reutiliza el proceso entre invocaciones)
let dbReady = false;
app.use(async (req, res, next) => {
  if (!dbReady) {
    await initDB();
    dbReady = true;
  }
  next();
});

app.use('/api/auth',         require('../../routes/auth'));
app.use('/api/clientes',     require('../../routes/clientes'));
app.use('/api/membresias',   require('../../routes/membresias'));
app.use('/api/planes',       require('../../routes/planes'));
app.use('/api/pagos',        require('../../routes/pagos'));
app.use('/api/asistencia',   require('../../routes/asistencia'));
app.use('/api/productos',    require('../../routes/productos'));
app.use('/api/ventas',       require('../../routes/ventas'));
app.use('/api/caja',         require('../../routes/caja'));
app.use('/api/dashboard',    require('../../routes/dashboard'));
app.use('/api/reports',      require('../../routes/reports'));
app.use('/api/landing',      require('../../routes/landing'));
app.use('/api/solicitudes',  require('../../routes/solicitudes'));

// binary: true hace que serverless-http codifique TODA respuesta en base64
// antes de enviarla a Netlify/Lambda. Sin esto, los archivos binarios como
// .xlsx (que son ZIPs internamente) se corrompen al convertirse a UTF-8.
module.exports.handler = serverless(app, {
  binary: (headers) => {
    const ct = (headers['content-type'] || '').toLowerCase();
    return (
      ct.includes('spreadsheetml') ||   // .xlsx
      ct.includes('octet-stream')   ||   // binario genérico
      ct.includes('pdf')            ||   // PDF
      ct.includes('zip')            ||   // ZIP
      ct.includes('image/')              // imágenes
    );
  }
});
