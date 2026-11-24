process.env.AG_DAEMON_LIBRARY = '1';

const { startDaemon, stopDaemon } = await import('../../core/daemon.mjs');

await startDaemon({ sidecarMode: true });

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.race([
      stopDaemon({ teardownUi: true }),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
  } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
