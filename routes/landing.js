const router = require('express').Router();
const LandingConfig = require('../models/LandingConfig');
const { verifyToken, requireRole } = require('../middleware/auth');
const { saveImage, deleteImage } = require('../config/storage');

// GET público
router.get('/', async (req, res) => {
  try {
    const config = await LandingConfig.findById('singleton');
    res.json(config || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT admin
router.put('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const cfg = await LandingConfig.findById('singleton') || {};

    let logo_url        = cfg.logo_url;
    let about_logo_url  = cfg.about_logo_url;
    let hero_bg_url     = cfg.hero_bg_url;
    let about_img_url   = cfg.about_img_url;

    if (req.files?.logo)       { await deleteImage(logo_url);       logo_url       = await saveImage(req.files.logo.data,       'index', req.files.logo.name); }
    if (req.files?.about_logo) { await deleteImage(about_logo_url); about_logo_url = await saveImage(req.files.about_logo.data, 'index', req.files.about_logo.name); }
    if (req.files?.hero_bg)    { await deleteImage(hero_bg_url);    hero_bg_url    = await saveImage(req.files.hero_bg.data,    'index', req.files.hero_bg.name); }
    if (req.files?.about_img)  { await deleteImage(about_img_url);  about_img_url  = await saveImage(req.files.about_img.data,  'index', req.files.about_img.name); }

    const updated = await LandingConfig.findByIdAndUpdate(
      'singleton',
      { logo_url, about_logo_url, hero_bg_url, about_img_url },
      { new: true, upsert: true }
    );
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
