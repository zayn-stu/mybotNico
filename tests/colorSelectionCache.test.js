const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setColors,
  setSelectedRole,
  getColors,
  getColorsAndClear,
} = require('../features/roles/colorSelectionCache');

test('color selection cache keeps self and target contexts separate', () => {
  setColors('guild-1', 'admin-1', '#111111', null);
  setColors('guild-1', 'admin-1', '#222222', '#333333', 'target-1');

  assert.deepEqual(getColors('guild-1', 'admin-1'), {
    primaryColor: '#111111',
    secondaryColor: null,
  });
  assert.deepEqual(getColors('guild-1', 'admin-1', 'target-1'), {
    primaryColor: '#222222',
    secondaryColor: '#333333',
  });
});

test('color selection cache stores selected existing role with colors', () => {
  setColors('guild-2', 'admin-2', '#AAAAAA', null, 'target-2');
  setSelectedRole('guild-2', 'admin-2', 'role-2', 'target-2');

  assert.deepEqual(getColorsAndClear('guild-2', 'admin-2', 'target-2'), {
    primaryColor: '#AAAAAA',
    secondaryColor: null,
    selectedRoleId: 'role-2',
  });
  assert.equal(getColors('guild-2', 'admin-2', 'target-2'), null);
});
