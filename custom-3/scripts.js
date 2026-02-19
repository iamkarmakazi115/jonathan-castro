/* ================================================
   CUSTOM 3 - PRIVATE CHAT
   Handles: Login, JWT Auth, Jitsi Meet Embed (iframe)
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
    roomName: 'CastroPrivateChat',

    // How often to check if the token is still valid (in milliseconds)
    tokenCheckMs: 300000  // 5 minutes
};

// ================================================
// STATE - Tracks the current user session
// ================================================
let currentUser = null;
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
    if (!token) return;

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
                currentUser = data.user;
                showChatScreen();
                return;
            }
        }

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

    hideError();

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
            sessionStorage.setItem('chat_token', data.token);
            currentUser = data.user;
            showChatScreen();
        } else {
            showError(data.error || 'Invalid email or password');
        }
    } catch (err) {
        console.error('Login failed:', err);
        showError('Unable to connect to the server. Please try again.');
    } finally {
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
    if (tokenCheckInterval) {
        clearInterval(tokenCheckInterval);
        tokenCheckInterval = null;
    }

    sessionStorage.removeItem('chat_token');
    currentUser = null;

    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('chat-screen').style.display = 'none';
    document.getElementById('jitsi-container').innerHTML = '';
    document.getElementById('login-form').reset();
    hideError();
}

// ================================================
// SHOW CHAT SCREEN
// Switches from login to the Jitsi video chat
// ================================================
function showChatScreen() {
    const displayName = currentUser.displayName || currentUser.email;
    const initials = getInitials(displayName);

    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = displayName;

    const roleEl = document.getElementById('user-role');
    roleEl.textContent = currentUser.role;
    roleEl.className = `user-role ${currentUser.role}`;

    document.getElementById('room-name-display').textContent = `Room: ${CONFIG.roomName}`;

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';

    launchJitsi();
    startTokenCheck();
}

// ================================================
// LAUNCH JITSI MEET (iframe approach)
// Embeds Jitsi as an iframe - no external script needed
// ================================================
function launchJitsi() {
    const container = document.getElementById('jitsi-container');
    container.innerHTML = '';

    const displayName = currentUser.displayName || currentUser.email;

    // Build the Jitsi iframe URL with config parameters
    const params = new URLSearchParams();

    // Jitsi URL hash config options
    const configParams = [
        'config.startWithAudioMuted=true',
        'config.startWithVideoMuted=true',
        'config.prejoinConfig.enabled=false',
        'config.disableInviteFunctions=true',
        'config.hideConferenceSubject=false',
        'config.subject=Private Chat',
        `userInfo.displayName=${encodeURIComponent(displayName)}`,
        `userInfo.email=${encodeURIComponent(currentUser.email)}`,
        'interfaceConfig.SHOW_JITSI_WATERMARK=false',
        'interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false',
        'interfaceConfig.SHOW_BRAND_WATERMARK=false',
        'interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false',
        'interfaceConfig.MOBILE_APP_PROMO=false',
        'interfaceConfig.HIDE_INVITE_MORE_HEADER=true'
    ];

    const jitsiUrl = `https://${CONFIG.jitsiDomain}/${CONFIG.roomName}#${configParams.join('&')}`;

    // Create the iframe
    const iframe = document.createElement('iframe');
    iframe.src = jitsiUrl;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.allow = 'camera; microphone; display-capture; autoplay; clipboard-write; hid';
    iframe.allowFullscreen = true;
    iframe.id = 'jitsi-iframe';

    container.appendChild(iframe);
}

// ================================================
// TOKEN CHECK
// Periodically verifies the token is still valid
// ================================================
function startTokenCheck() {
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
    }, CONFIG.tokenCheckMs);
}

// ================================================
// HELPER FUNCTIONS
// ================================================

function getInitials(name) {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

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

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    errorText.textContent = message;
    errorDiv.style.display = 'flex';
    errorDiv.style.animation = 'none';
    errorDiv.offsetHeight;
    errorDiv.style.animation = 'shake 0.4s ease';
}

function hideError() {
    document.getElementById('error-message').style.display = 'none';
}
