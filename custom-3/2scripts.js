/* ================================================
   CUSTOM 3 - PRIVATE CHAT
   Handles: Login, JWT Auth, Jitsi Meet Embed
   ================================================ */

// ================================================
// CONFIGURATION - Edit these values as needed
// ================================================
const CONFIG = {
    // Your API base URL (no trailing slash)
    apiUrl: 'https://api.jonathan-castro.com',

    // Your Jitsi server domain
    jitsiDomain: 'chat.jonathan-castro.com',

    // The name of the video chat room (all users join the same room)
    // Change this to anything you want - it's the "room name" in Jitsi
    roomName: 'CastroPrivateChat',

    // How long before token expiry to show a warning (in milliseconds)
    // 24 hours = 86400000ms, warn at 1 hour left = 3600000ms
    tokenWarningMs: 3600000
};

// ================================================
// STATE - Tracks the current user session
// ================================================
let currentUser = null;
let jitsiApi = null;
let tokenCheckInterval = null;

// ================================================
// ON PAGE LOAD - Check if user is already logged in
// ================================================
document.addEventListener('DOMContentLoaded', () => {
    // Set up form handler
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // Set up logout button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Set up password toggle
    document.querySelector('.toggle-password').addEventListener('click', togglePassword);

    // Check for existing session
    checkExistingSession();
});

// ================================================
// CHECK EXISTING SESSION
// If user has a valid token stored, skip the login
// ================================================
async function checkExistingSession() {
    const token = sessionStorage.getItem('chat_token');
    if (!token) return; // No token, show login screen

    try {
        const response = await fetch(`${CONFIG.apiUrl}/api/auth/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.valid) {
                // Token is still good - go straight to chat
                currentUser = data.user;
                showChatScreen();
                return;
            }
        }

        // Token is invalid or expired - clear it
        sessionStorage.removeItem('chat_token');
    } catch (err) {
        console.error('Session check failed:', err);
        sessionStorage.removeItem('chat_token');
    }
}

// ================================================
// HANDLE LOGIN
// Sends email/password to your API, gets JWT back
// ================================================
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');

    // Hide any previous error
    hideError();

    // Show loading state
    loginBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'flex';

    try {
        const response = await fetch(`${CONFIG.apiUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.token) {
            // Login successful!
            // Store the token for this browser tab session
            sessionStorage.setItem('chat_token', data.token);
            currentUser = data.user;
            showChatScreen();
        } else {
            // Login failed - show the error
            showError(data.error || 'Invalid email or password');
        }
    } catch (err) {
        console.error('Login failed:', err);
        showError('Unable to connect to the server. Please try again.');
    } finally {
        // Reset button state
        loginBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
    }
}

// ================================================
// HANDLE LOGOUT
// Clears the session and returns to login screen
// ================================================
function handleLogout() {
    // Destroy the Jitsi meeting
    if (jitsiApi) {
        jitsiApi.dispose();
        jitsiApi = null;
    }

    // Clear the token check
    if (tokenCheckInterval) {
        clearInterval(tokenCheckInterval);
        tokenCheckInterval = null;
    }

    // Clear stored session
    sessionStorage.removeItem('chat_token');
    currentUser = null;

    // Show login screen, hide chat screen
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('chat-screen').style.display = 'none';

    // Clear the Jitsi container
    document.getElementById('jitsi-container').innerHTML = '';

    // Clear the form
    document.getElementById('login-form').reset();
    hideError();
}

// ================================================
// SHOW CHAT SCREEN
// Switches from login to the Jitsi video chat
// ================================================
function showChatScreen() {
    // Update user info in the top bar
    const displayName = currentUser.displayName || currentUser.email;
    const initials = getInitials(displayName);

    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = displayName;

    const roleEl = document.getElementById('user-role');
    roleEl.textContent = currentUser.role;
    roleEl.className = `user-role ${currentUser.role}`;

    document.getElementById('room-name-display').textContent = `Room: ${CONFIG.roomName}`;

    // Switch screens
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';

    // Launch Jitsi Meet
    launchJitsi();

    // Start checking if the token is still valid
    startTokenCheck();
}

// ================================================
// LAUNCH JITSI MEET
// Embeds the Jitsi video chat using the External API
// ================================================
function launchJitsi() {
    // Clean up any existing instance
    if (jitsiApi) {
        jitsiApi.dispose();
        jitsiApi = null;
    }

    const container = document.getElementById('jitsi-container');
    container.innerHTML = '';

    const displayName = currentUser.displayName || currentUser.email;

    // Configure the Jitsi meeting
    const options = {
        roomName: CONFIG.roomName,
        parentNode: container,
        width: '100%',
        height: '100%',
        userInfo: {
            displayName: displayName,
            email: currentUser.email
        },
        configOverrides: {
            // Start with audio/video muted so users can choose
            startWithAudioMuted: true,
            startWithVideoMuted: true,

            // Disable pre-join page since we already authenticated
            prejoinConfig: {
                enabled: false
            },

            // UI customizations
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,

            // Disable invite options (private room)
            disableInviteFunctions: true,

            // Hide some toolbar buttons we don't need
            toolbarButtons: [
                'microphone',
                'camera',
                'desktop',
                'chat',
                'raisehand',
                'participants-pane',
                'tileview',
                'fullscreen',
                'settings',
                'hangup'
            ],

            // Set the subject/title
            subject: 'Private Chat'
        },
        interfaceConfigOverrides: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_CHROME_EXTENSION_BANNER: false,
            MOBILE_APP_PROMO: false,
            HIDE_INVITE_MORE_HEADER: true,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: false
        }
    };

    // Create the Jitsi meeting
    jitsiApi = new JitsiMeetExternalAPI(CONFIG.jitsiDomain, options);

    // Listen for when the user hangs up
    jitsiApi.addEventListener('videoConferenceLeft', () => {
        console.log('User left the conference');
        // Optionally auto-logout when user hangs up:
        // handleLogout();
    });

    // Listen for errors
    jitsiApi.addEventListener('errorOccurred', (error) => {
        console.error('Jitsi error:', error);
    });
}

// ================================================
// TOKEN CHECK
// Periodically verifies the token is still valid
// ================================================
function startTokenCheck() {
    // Check every 5 minutes
    tokenCheckInterval = setInterval(async () => {
        const token = sessionStorage.getItem('chat_token');
        if (!token) {
            handleLogout();
            return;
        }

        try {
            const response = await fetch(`${CONFIG.apiUrl}/api/auth/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                alert('Your session has expired. Please log in again.');
                handleLogout();
            }
        } catch (err) {
            console.error('Token check failed:', err);
        }
    }, 300000); // 300000ms = 5 minutes
}

// ================================================
// HELPER FUNCTIONS
// ================================================

// Get initials from a display name (e.g., "Jonathan Admin" -> "JA")
function getInitials(name) {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

// Toggle password visibility
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const eyeOpen = this.querySelector('.eye-open');
    const eyeClosed = this.querySelector('.eye-closed');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
    } else {
        passwordInput.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
    }
}

// Show error message with animation
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    errorText.textContent = message;
    errorDiv.style.display = 'flex';

    // Re-trigger shake animation
    errorDiv.style.animation = 'none';
    errorDiv.offsetHeight; // Force reflow
    errorDiv.style.animation = 'shake 0.4s ease';
}

// Hide error message
function hideError() {
    document.getElementById('error-message').style.display = 'none';
}
