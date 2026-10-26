// A packaged app contains both the desktop UI and its fixed, rendererless helper.
if(process.env.GROKDECK_HELPER==='live'&&process.argv.includes('--grokdeck-live-helper')) {
  require('../bridge/live.cjs');
} else {
  require('./app.cjs');
}
