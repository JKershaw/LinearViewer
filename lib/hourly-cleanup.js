/**
 * The hourly cleanup run (LIN-3424). Moved out of server.js's listen callback
 * so a unit test can drive one tick; server.js arms it with
 * `setInterval(run, CLEANUP_INTERVAL_MS)` and holds the timer for shutdown.
 *
 * This run is the only trigger for sweeping expired sessions. The blocks are
 * hand-written on purpose — not a registry — and each has its own try/catch,
 * so one store failing never skips the rest.
 */

/**
 * @param {Object} stores
 * @param {{log: Function, error: Function}} [stores.logger=console]
 * @returns {() => Promise<void>} One hourly tick.
 */
export function createHourlyCleanupRun({
  dispatchQueueStore,
  freeTierStore,
  proxyTokenStore,
  observationSessionsStore,
  harbourFeedbackTokenStore,
  observerStateStore,
  observerShadowLogStore,
  sessionStore,
  logger = console
}) {
  return async () => {
    try {
      const removedCount = await dispatchQueueStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Dispatch queue cleanup: removed ${removedCount} expired items`)
      }
    } catch (err) {
      logger.error('Dispatch queue cleanup error:', err)
    }
    try {
      const removedCount = await freeTierStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Free tier cleanup: removed ${removedCount} expired records`)
      }
    } catch (err) {
      logger.error('Free tier cleanup error:', err)
    }
    try {
      const removedCount = await proxyTokenStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Proxy token cleanup: removed ${removedCount} expired/consumed tokens`)
      }
    } catch (err) {
      logger.error('Proxy token cleanup error:', err)
    }
    try {
      const removedCount = await observationSessionsStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Observation sessions cleanup: removed ${removedCount} expired derived docs`)
      }
    } catch (err) {
      logger.error('Observation sessions cleanup error:', err)
    }
    try {
      const removedCount = await harbourFeedbackTokenStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Harbour feedback token cleanup: removed ${removedCount} expired tokens`)
      }
    } catch (err) {
      logger.error('Harbour feedback token cleanup error:', err)
    }
    try {
      const removedCount = await observerStateStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Observer state cleanup: removed ${removedCount} decommissioned instance(s)`)
      }
    } catch (err) {
      logger.error('Observer state cleanup error:', err)
    }
    try {
      const removedCount = await observerShadowLogStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Observer shadow log cleanup: removed ${removedCount} aged entries`)
      }
    } catch (err) {
      logger.error('Observer shadow log cleanup error:', err)
    }
    try {
      const removedCount = await sessionStore.cleanup()
      if (removedCount > 0) {
        logger.log(`Session cleanup: removed ${removedCount} expired sessions`)
      }
    } catch (err) {
      logger.error('Session cleanup error:', err)
    }
  }
}
