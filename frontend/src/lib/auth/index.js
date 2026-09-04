export {
    AUTH_TOKEN_KEY,
    authError,
    authStatus,
    authToken,
    canAccessCreatorTools,
    canAccessStudio,
    currentUser,
    getAuthHeaders,
    getAuthToken,
    hasRole,
    isAuthenticated,
    isAuthenticatedSync,
    login,
    logout,
    refreshSession,
    register,
    studioAccessAllowed,
    userRole
} from './authStore.js';

export {
    AUTH_ROLES,
    classifyPath,
    evaluateRouteAccess,
    hasRole as roleHas,
    isAdminRole,
    isCreatorRole,
    normalizeRole,
    roleMeets
} from './roles.js';

export { clientNavigate, requestOpenStudio } from './clientNavigate.js';

export {
    AUTH_RETURN_PATH_KEY,
    buildAuthPath,
    buildLoginPath,
    mapAuthErrorMessage,
    peekStoredReturnPath,
    readNextFromSearch,
    resolvePostAuthDestination,
    sanitizeReturnPath,
    setStoredReturnPath,
    takeStoredReturnPath
} from './returnPath.js';

export {
    readStudioAutoEnterPreference,
    writeStudioAutoEnterPreference,
    readViewerPreviewMode,
    writeViewerPreviewMode,
    showStudioLinkOnViewerLogin
} from './studioEntryPreferences.js';

export { unlockStudioWithPassword } from './studioAdminAuth.js';
