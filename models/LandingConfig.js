const mongoose = require('mongoose');

const landingConfigSchema = new mongoose.Schema({
  _id:           { type: String, default: 'singleton' },
  logo_url:      { type: String, default: null },
  about_logo_url:{ type: String, default: null },
  hero_bg_url:   { type: String, default: null },
  about_img_url: { type: String, default: null },
});

module.exports = mongoose.model('LandingConfig', landingConfigSchema);
