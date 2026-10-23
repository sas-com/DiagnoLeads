import * as migration_20261023_125237_initial from './20261023_125237_initial';

export const migrations = [
  {
    up: migration_20261023_125237_initial.up,
    down: migration_20261023_125237_initial.down,
    name: '20261023_125237_initial',
  },
];
