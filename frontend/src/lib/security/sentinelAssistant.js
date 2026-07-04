/**
 * Backward-compatible re-exports — prefer `../sentinel/sentinelAssistant.js`.
 */
export {
    SENTINEL_ASSISTANT_VERSION,
    SENTINEL_QUESTIONS,
    analyzePlatform,
    analyzeSecurity,
    analyzeProduction,
    analyzePublishing,
    analyzeWorkflows,
    analyzeWorkflow,
    analyzeTeams,
    masterAnalysis,
    buildSentinelAnalysis,
    getSentinelGuideMeOverlay,
    askSentinel,
    buildSentinelReports,
    initSentinelAssistant,
    logSentinelDiag
} from '../sentinel/sentinelAssistant.js';
