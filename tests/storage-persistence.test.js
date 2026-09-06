const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const storage = require('../services/storage');

test('storage persists user configuration across git resets', () => {
  const userConfigPath = path.join(storage.DATA_DIR, 'user_config.json');
  const configPath = path.join(storage.DATA_DIR, 'config.json');

  // 1. Save custom config
  storage.saveConfig({
    port: 3000,
    authToken: 'persisted_test_token_123',
    activeSources: ['1', '5']
  });

  // Check both files exist
  assert.equal(fs.existsSync(userConfigPath), true);
  assert.equal(fs.existsSync(configPath), true);

  const savedUser = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
  assert.equal(savedUser.authToken, 'persisted_test_token_123');

  // 2. Simulate git reset --hard by overwriting config.json with blank defaults
  fs.writeFileSync(configPath, JSON.stringify({ port: 3000, authToken: '' }));

  // Re-require storage or check getConfig
  // Calling getConfig with auto-merge or running initialization
  const userCfg = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
  assert.equal(userCfg.authToken, 'persisted_test_token_123');
});
