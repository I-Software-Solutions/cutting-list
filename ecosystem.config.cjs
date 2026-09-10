module.exports = {
  apps: [{
    name: 'cutting-list',
    script: './artifacts/api-server/dist/index.mjs',
    cwd: '/home/replit/cutting-list',
    env_file: '.env',
    env: { NODE_ENV: 'production', PORT: '3001' },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
  }],
};
