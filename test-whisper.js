const speechService = require('./src/services/speech.service');
async function test() {
  try {
    console.log('Testing Whisper...');
    await speechService.initialize();
    const status = speechService.getStatus();
    console.log('✅ Working! Status:', status);
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}
test();
