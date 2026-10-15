const config = require('nodemon/lib/config');
const match = require('nodemon/lib/monitor/match');

let options;
beforeAll(done => {
  // Cargar configuración y evaluar el matcher real, sin iniciar ni reiniciar servidores.
  config.load({ script: 'server.js' }, loaded => {
    options = loaded.options;
    done();
  });
});

const provocaReinicio = file => match([file], [...options.monitor], options.execOptions.ext).result.length > 0;

test.each(['db-export/membresias.json', 'db-export/clientes.json', 'db-export/pagos.json',
  'coverage/coverage-final.json', 'public/js/router.js', 'tests/helpers/membresias-browser-smoke.js',
  '.opencode/opencode.json', 'logs/server.log'])('%s no provoca reinicios del backend', file => {
  expect(provocaReinicio(file)).toBe(false);
});

test.each(['server.js', 'config/database.js', 'models/Membresia.js', 'routes/membresias.js',
  'services/MembresiaService.js', 'middleware/auth.js', 'utils/membresiaPeriodos.js',
  'functions/agenteFunctions.js', 'package.json', '.env'])('%s mantiene la recarga de desarrollo', file => {
  expect(provocaReinicio(file)).toBe(true);
});
