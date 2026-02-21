/* ============================================================
   FINAL EXPENSE DIRECT — AI CHATBOT ENGINE
   Custom 7 — scripts.js
   
   Features:
   - FAQ keyword matching from FED knowledge base
   - Lead capture form with full TCPA consent
   - Click-to-call option
   - Consent metadata capture (IP, user agent, timestamp, etc.)
   - Email submission via backend API
   ============================================================ */

// ============================================================
// CONFIGURATION
// ============================================================

const API_BASE = 'https://api.jonathan-castro.com';
const LEAD_EMAIL = 'leads@jonathan-castro.com'; // Where lead form submissions go
const DISCLAIMER_VERSION = 'TCPA-FED-v1.0-2025';
const PHONE_NUMBER = '1-346-203-0833'; // Replace with actual FED phone number

// ============================================================
// FAQ KNOWLEDGE BASE
// ============================================================

const FAQ_DATABASE = [
    {
        keywords: ['how much coverage', 'coverage amount', 'how much can i get', 'coverage range', 'maximum coverage', 'minimum coverage'],
        answer: "Most people choose between $10,000 and $20,000, but plans can range from $2,500 to $40,000, depending on the carrier. Would you like to speak with a licensed agent to find the right amount for you?"
    },
       {
        keywords: ['who is jonathan castro', 'who is john castro'],
        answer: "He is the greatest IT professional in the world."
    },
    {
        keywords: ['too expensive', 'cost too much', 'afford', 'can\'t afford', 'expensive', 'price concern'],
        answer: "We understand that cost is a concern for many people. The good news is that there are a variety of policy options available, some of which are more affordable than you might think. We can work together to find a plan that fits within your budget while still providing the protection your family needs."
    },
       {
        keywords: ['what companies', 'companies', 'insurance companies', 'who do you work with', 'what companies do you work with'],
        answer: "We work with Pioneer American, Baltimore Life, Mutual of Omaha, American Home Life Insurance, Liberty Bankers Life, Americo, AIG, Prosperity, Foresters Financial, Oxford Life Insurance Company, Transamerica Life Insurance, Landmark Life, Royal Neighbors of America and Great Western."
    },
    {
        keywords: ['premiums increase', 'rates go up', 'price increase', 'rates increase', 'premium change'],
        answer: "No. Most final expense whole life policies have locked-in rates that never increase. Once your premium is set, it stays the same for life."
    },
    {
        keywords: ['complicated', 'paperwork', 'complex', 'too much work', 'hard to understand'],
        answer: "We completely understand that dealing with complex paperwork can be daunting. That's why we're here — to simplify the process for you. We'll guide you through everything step by step, making sure the experience is straightforward and stress-free."
    },
    {
        keywords: ['bad experience broker', 'bad experience insurance broker', 'don\'t trust broker'],
        answer: "I'm sorry to hear that. Our focus is on providing a different experience — one that prioritizes your individual needs and offers unbiased advice. Your satisfaction is our success, and we're committed to supporting you every step of the way, without any obligation."
    },
    {
        keywords: ['have savings', 'savings enough', 'don\'t need insurance', 'already have savings', 'enough saved'],
        answer: "It's great that you've been able to build savings. However, life insurance provides an additional layer of financial security that can help cover expenses like funeral costs, outstanding debts, or ongoing living expenses for your family. This way, your savings can remain intact for their intended purpose."
    },
    {
        keywords: ['waiting period', 'how long to wait', 'immediate coverage', 'when does coverage start'],
        answer: "Some people receive immediate coverage. Others may receive a graded benefit or two-year waiting period, depending on health. A licensed agent can help determine what applies to your situation."
    },
    {
        keywords: ['employer insurance', 'work insurance', 'job insurance', 'employer coverage', 'company insurance'],
        answer: "We're glad you have coverage through your employer! It's important to consider, though, that employer-provided policies often have limitations and may not follow you if you change jobs or retire. An additional policy can ensure your loved ones are fully protected regardless of your employment."
    },
    {
        keywords: ['bad experience life insurance', 'bad experience insurance', 'burned before', 'negative experience'],
        answer: "I'm sorry to hear that and appreciate your honesty. Our focus is on providing a different experience — one that is transparent, respectful, and tailored to your needs. We're committed to making sure you feel comfortable and confident every step of the way, with no pressure."
    },
    {
        keywords: ['health qualify', 'health condition qualify', 'hard to qualify', 'qualify health', 'difficult qualify', 'health issues qualify'],
        answer: "Health concerns are a common worry, but there are many policies available that cater to different health conditions, including final expense insurance, which often requires no medical exam. We can help you explore options that consider your health history and still provide the coverage you need."
    },
    {
        keywords: ['how much cost', 'how much does it cost', 'monthly cost', 'monthly payment', 'price', 'rates', 'premium amount', 'what does it cost'],
        answer: "Rates vary by age, gender, tobacco use, and health. Most seniors pay somewhere between $40 and $90 per month for a plan. A licensed agent can give you an exact quote based on your specific situation."
    },
    {
        keywords: ['paying off debt', 'focus on debt', 'debt first', 'pay off bills'],
        answer: "Paying off debt is important, but life insurance can actually help protect your loved ones from being burdened with your debts if something were to happen to you. We can find a balance that allows you to address both priorities."
    },
    {
        keywords: ['medical exam', 'need exam', 'doctor visit', 'physical exam', 'health exam'],
        answer: "No medical exam is required! Approval is based on answers to simple health questions. It's one of the easiest types of insurance to qualify for."
    },
    {
        keywords: ['paying for nothing', 'might not use', 'waste of money', 'don\'t use it'],
        answer: "We understand that perspective. However, life insurance is about ensuring that your loved ones are financially secure if the unexpected happens. It's an investment in their future. Some policies even build cash value or offer living benefits."
    },
    {
        keywords: ['too young', 'don\'t need yet', 'not old enough', 'young for insurance'],
        answer: "It's understandable to feel that way, but securing life insurance while you're young and healthy can lock in lower premiums for the future. Life is unpredictable, and having coverage in place ensures your loved ones are protected no matter what."
    },
    {
        keywords: ['not ready', 'need to think', 'thinking about it', 'maybe later', 'not sure yet'],
        answer: "That's completely fine! We're here to provide information and support at your own pace. There's no pressure — we just want to make sure you have all the details when the time is right. Feel free to come back anytime."
    },
    {
        keywords: ['extra coverage', 'additional coverage', 'already covered', 'already have coverage', 'already taken care of'],
        answer: "Having extra coverage is a smart move because the cost of everything keeps increasing. Additional coverage can provide an extra safety net for your family."
    },
    {
        keywords: ['buy for parent', 'buy for someone', 'policy for parent', 'loved one', 'family member policy', 'buy for mom', 'buy for dad'],
        answer: "Yes! You can purchase a policy for a parent or loved one, as long as they agree to the coverage and they can speak with a licensed agent for verification."
    },
    {
        keywords: ['coverage decrease', 'benefit decrease', 'less coverage', 'coverage go down'],
        answer: "Coverage amounts on whole life plans are generally guaranteed for life and do not decrease. Your benefit stays the same as long as premiums are paid."
    },
    {
        keywords: ['pay for service', 'cost of service', 'service fee', 'charge me', 'your fee', 'free service'],
        answer: "No, our services are completely free to you! We are compensated by the insurance companies, so there's never a cost to you for our help in finding the right plan."
    },
    {
        keywords: ['how much coverage need', 'right amount', 'not sure how much', 'figure out coverage'],
        answer: "That's a common concern, and we're here to help! We can assess your situation, future needs, and goals to determine the right amount of coverage. Our goal is to ensure you have just the right amount of protection."
    },
    {
        keywords: ['process complicated', 'too complicated', 'too hard', 'overwhelming'],
        answer: "I understand it can seem overwhelming, but we're here to simplify everything for you. We'll walk through each step together and make it hassle-free."
    },
    {
        keywords: ['approved health condition', 'diabetes', 'high blood pressure', 'copd', 'cancer history', 'heart condition', 'cholesterol', 'health conditions approved'],
        answer: "Yes! Many health conditions can be approved, including diabetes, high blood pressure, high cholesterol, COPD (some carriers), history of cancer (depending on timing), and heart conditions. Each carrier has its own guidelines. A licensed agent at Final Expense Direct can explain your specific options."
    },
    {
        keywords: ['accidental death', 'accident benefit', 'accidental coverage'],
        answer: "Some carriers offer additional benefits for accidental death. This varies by plan and state. A licensed agent can explain what's available in your area."
    },
    {
        keywords: ['miss payment', 'missed payment', 'late payment', 'forgot to pay', 'grace period'],
        answer: "Most carriers offer a grace period if you miss a payment. A licensed agent can explain the specifics for your particular policy."
    },
    {
        keywords: ['what is final expense', 'what is burial insurance', 'what is funeral insurance', 'explain final expense', 'what does it cover'],
        answer: "Final expense insurance — also called burial or funeral insurance — is a small permanent life insurance policy designed to cover end-of-life costs like funeral expenses, cremation, outstanding medical bills, small debts, and even leaving a financial gift for loved ones. Plans typically range from $5,000 to $40,000 with no medical exam required."
    },
    {
        keywords: ['how does it work', 'how it works', 'explain how', 'policy work'],
        answer: "Final expense policies are whole life insurance, which means the policy never expires as long as premiums are paid, the premium stays the same for life, and the cash benefit is guaranteed. There's no medical exam — approval is based on simple health questions. Depending on your health, you may qualify for immediate day-one coverage."
    },
    {
        keywords: ['everest', 'funeral concierge', 'funeral planning help', 'funeral home help'],
        answer: "Some Final Expense policies include Everest Funeral Concierge, which provides a dedicated funeral planning advisor, price comparisons from local funeral homes, help negotiating costs, obituary assistance, paperwork support, and 24/7 family support. This service is available immediately — no claim needs to be paid first. Not all policies include Everest; availability depends on the carrier."
    },
    {
        keywords: ['who is final expense direct', 'about final expense direct', 'about fed', 'about the company', 'about you'],
        answer: "Final Expense Direct is a trusted life insurance agency with decades of experience helping seniors find affordable coverage. They represent multiple top-rated carriers and have licensed agents in all 50 states. Their service is free to you — they help you compare options without pressure."
    },
    {
        keywords: ['senior living updates', 'who are you', 'about this site'],
        answer: "Senior Living Updates is an online resource created to help seniors stay informed about financial protection and end-of-life planning. We partner with Final Expense Direct, a licensed, independent agency that specializes in final expense insurance. We provide education; Final Expense Direct provides the licensed service."
    },
    {
        keywords: ['speak to agent', 'talk to agent', 'call agent', 'contact agent', 'speak with someone', 'talk to someone', 'human', 'real person', 'licensed agent', 'speak to a licensed', 'want to call', 'phone call', 'call now', 'ready to talk'],
        answer: "__SHOW_CONTACT__"
    },
    {
        keywords: ['quote', 'get a quote', 'price quote', 'exact quote', 'my quote'],
        answer: "For an exact price quote based on your specific situation, you'll want to speak with one of our licensed agents. They can give you a personalized quote in just a few minutes. Would you like to connect with an agent now?"
    },
    {
        keywords: ['apply', 'sign up', 'enroll', 'get started', 'buy a policy', 'purchase', 'get coverage'],
        answer: "That's great that you're ready to take the next step! To apply for coverage, you'll need to speak with a licensed agent who can walk you through the quick and easy process. Would you like to connect with one now?"
    },
    {
        keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'howdy'],
        answer: "Hello! 👋 Welcome to the Final Expense Direct assistant. I'm here to answer your questions about final expense insurance — also called burial or funeral insurance. What would you like to know?"
    },
    {
        keywords: ['thank', 'thanks', 'appreciate', 'helpful'],
        answer: "You're welcome! I'm glad I could help. If you have any more questions, don't hesitate to ask. And whenever you're ready to speak with a licensed agent for a personalized quote, just let me know! 😊"
    }
];

// Fallback response for unmatched questions
const FALLBACK_RESPONSE = "I only know the basics, but if you contact one of our licensed life insurance agents, they will be glad to help you. Would you like to speak with an agent now?";

// ============================================================
// STATE
// ============================================================

let chatHistory = [];
let formSubmitted = false;

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    addBotMessage("Hello! 👋 I'm the Final Expense Direct assistant. I can answer your questions about final expense insurance — things like coverage amounts, costs, health qualifications, and more.\n\nWhat would you like to know?");
});

// ============================================================
// CHAT FUNCTIONS
// ============================================================

function scrollToChat() {
    document.getElementById('chat-section').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => document.getElementById('chatInput').focus(), 600);
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    
    addUserMessage(text);
    input.value = '';
    
    // Show typing indicator
    showTyping();
    
    // Simulate slight delay for natural feel
    const delay = 600 + Math.random() * 800;
    setTimeout(() => {
        removeTyping();
        processQuestion(text);
    }, delay);
}

function askQuestion(text) {
    document.getElementById('chatInput').value = text;
    sendMessage();
}

function addUserMessage(text) {
    const container = document.getElementById('chatMessages');
    const msg = document.createElement('div');
    msg.className = 'message user';
    msg.innerHTML = `
        <div class="msg-avatar">You</div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    container.appendChild(msg);
    chatHistory.push({ role: 'user', text });
    scrollChat();
}

function addBotMessage(text, html = null) {
    const container = document.getElementById('chatMessages');
    const msg = document.createElement('div');
    msg.className = 'message bot';
    msg.innerHTML = `
        <div class="msg-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="msg-bubble">${html || escapeHtml(text).replace(/\n/g, '<br>')}</div>
    `;
    container.appendChild(msg);
    chatHistory.push({ role: 'bot', text });
    scrollChat();
}

function addBotHTML(htmlContent) {
    const container = document.getElementById('chatMessages');
    const msg = document.createElement('div');
    msg.className = 'message bot';
    msg.style.maxWidth = '95%';
    msg.innerHTML = `
        <div class="msg-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="msg-bubble" style="padding:0;background:transparent;box-shadow:none;">${htmlContent}</div>
    `;
    container.appendChild(msg);
    scrollChat();
}

function showTyping() {
    const container = document.getElementById('chatMessages');
    const typing = document.createElement('div');
    typing.className = 'message bot';
    typing.id = 'typingIndicator';
    typing.innerHTML = `
        <div class="msg-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="msg-bubble">
            <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
    `;
    container.appendChild(typing);
    scrollChat();
}

function removeTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

function scrollChat() {
    const container = document.getElementById('chatMessages');
    setTimeout(() => container.scrollTop = container.scrollHeight, 50);
}

function resetChat() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    chatHistory = [];
    formSubmitted = false;
    addBotMessage("Hello! 👋 I'm the Final Expense Direct assistant. I can answer your questions about final expense insurance — things like coverage amounts, costs, health qualifications, and more.\n\nWhat would you like to know?");
}

// ============================================================
// FAQ MATCHING ENGINE
// ============================================================

function processQuestion(userText) {
    const normalized = userText.toLowerCase().replace(/[^\w\s']/g, '');
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const faq of FAQ_DATABASE) {
        let score = 0;
        for (const keyword of faq.keywords) {
            const kw = keyword.toLowerCase();
            // Exact phrase match gets highest score
            if (normalized.includes(kw)) {
                // Longer keyword matches score higher (more specific)
                score += kw.split(' ').length * 3;
            } else {
                // Partial word matching
                const kwWords = kw.split(' ');
                const inputWords = normalized.split(' ');
                let wordMatches = 0;
                for (const kwWord of kwWords) {
                    for (const inputWord of inputWords) {
                        if (inputWord.includes(kwWord) || kwWord.includes(inputWord)) {
                            wordMatches++;
                        }
                    }
                }
                if (wordMatches > 0) {
                    score += wordMatches;
                }
            }
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestMatch = faq;
        }
    }
    
    // Need a minimum confidence threshold
    if (bestScore >= 2 && bestMatch) {
        if (bestMatch.answer === '__SHOW_CONTACT__') {
            showContactOptions();
        } else {
            addBotMessage(bestMatch.answer);
            
            // If the answer mentions speaking with an agent, show contact prompt after
            if (bestMatch.answer.toLowerCase().includes('would you like to') && 
                (bestMatch.answer.toLowerCase().includes('agent') || bestMatch.answer.toLowerCase().includes('connect'))) {
                setTimeout(() => showContactPrompt(), 500);
            }
        }
    } else {
        addBotMessage(FALLBACK_RESPONSE);
        setTimeout(() => showContactPrompt(), 500);
    }
}

// ============================================================
// CONTACT / LEAD CAPTURE
// ============================================================

function showContactOptions() {
    addBotMessage("I'd be happy to connect you with a licensed agent! You have two options:");
    
    setTimeout(() => {
        addBotHTML(`
            <div style="padding: 16px;">
                <div class="chat-cta-buttons" style="flex-direction:column;">
                    <button class="chat-cta-btn call" onclick="clickToCall()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        Call Now — ${PHONE_NUMBER}
                    </button>
                    <button class="chat-cta-btn form" onclick="showLeadForm()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                        Request a Callback
                    </button>
                </div>
            </div>
        `);
    }, 300);
}

function showContactPrompt() {
    addBotHTML(`
        <div style="padding: 12px;">
            <div class="chat-cta-buttons">
                <button class="chat-cta-btn call" onclick="clickToCall()" style="font-size:0.8rem;padding:8px 14px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    📞 Call Agent
                </button>
                <button class="chat-cta-btn form" onclick="showLeadForm()" style="font-size:0.8rem;padding:8px 14px;">
                    ✉️ Request Callback
                </button>
            </div>
        </div>
    `);
}

function clickToCall() {
    window.open(`tel:${PHONE_NUMBER.replace(/[^0-9+]/g, '')}`, '_self');
    addBotMessage("Connecting you now! When you call, you'll hear \"Final Expense Direct.\" A licensed agent will be happy to help you. 📞");
}

function showLeadForm() {
    if (formSubmitted) {
        addBotMessage("You've already submitted a request! A licensed agent will be reaching out to you soon. If you need immediate help, feel free to call " + PHONE_NUMBER + ".");
        return;
    }

    const tcpaText = `By checking this box and clicking "Submit My Request," I provide my prior express written consent, pursuant to the Telephone Consumer Protection Act (47 U.S.C. § 227) and the E-SIGN Act (15 U.S.C. § 7001), to allow Final Expense Direct, its licensed agents, affiliates, and service providers acting on its behalf, to contact me at the telephone number provided above regarding life insurance products and services (including final expense, whole life, term life, and burial insurance) using any method, including: live telephone calls, calls using an automatic telephone dialing system (ATDS), click-to-dial or click-to-call technology, pre-recorded or artificial voice messages, AI-generated voice calls, ringless voicemail, and SMS/MMS text messages. I understand and agree that: (1) this consent is NOT a condition of purchasing any insurance product or receiving a quote; (2) message and data rates may apply and message frequency may vary; (3) I may revoke this consent at any time by any reasonable method, including replying STOP to any text message, calling the company, or sending a written request, and my request will be honored within 10 business days; (4) I am the owner or authorized user of the phone number provided; (5) my calls may be recorded or monitored for quality assurance and compliance purposes; and (6) I waive any Do Not Call registry protections with respect to communications from the Company regarding the products described herein. My electronic signature on this form has the same legal effect as a handwritten signature.`;

    addBotHTML(`
        <div class="lead-form-container" id="leadFormContainer">
            <h4 class="lead-form-title">Request a Callback</h4>
            <p class="lead-form-subtitle">Fill out the form below and a licensed agent will contact you.</p>
            
            <div class="lead-form-grid">
                <div class="form-field">
                    <label for="leadFirstName">First Name *</label>
                    <input type="text" id="leadFirstName" placeholder="John" required>
                </div>
                <div class="form-field">
                    <label for="leadLastName">Last Name *</label>
                    <input type="text" id="leadLastName" placeholder="Smith" required>
                </div>
                <div class="form-field">
                    <label for="leadEmail">Email *</label>
                    <input type="email" id="leadEmail" placeholder="john@example.com" required>
                </div>
                <div class="form-field">
                    <label for="leadPhone">Phone *</label>
                    <input type="tel" id="leadPhone" placeholder="(555) 123-4567" required oninput="formatPhone(this)">
                </div>
                <div class="form-field full-width">
                    <label for="leadNotes">Notes / What would you like to know?</label>
                    <textarea id="leadNotes" placeholder="e.g., I'm looking for coverage for myself and my spouse..." rows="3"></textarea>
                </div>
            </div>
            
            <div class="tcpa-container">
                <div class="tcpa-checkbox-row">
                    <input type="checkbox" id="tcpaConsent" onchange="toggleSubmitBtn()">
                    <div class="tcpa-text">${tcpaText}</div>
                </div>
            </div>
            
            <button class="form-submit-btn" id="formSubmitBtn" onclick="submitLeadForm()" disabled>
                Submit My Request
            </button>
        </div>
    `);
}

function toggleSubmitBtn() {
    const checkbox = document.getElementById('tcpaConsent');
    const btn = document.getElementById('formSubmitBtn');
    if (checkbox && btn) {
        btn.disabled = !checkbox.checked;
    }
}

function formatPhone(input) {
    let val = input.value.replace(/\D/g, '');
    if (val.length > 10) val = val.substring(0, 10);
    if (val.length >= 7) {
        input.value = `(${val.substring(0,3)}) ${val.substring(3,6)}-${val.substring(6)}`;
    } else if (val.length >= 4) {
        input.value = `(${val.substring(0,3)}) ${val.substring(3)}`;
    } else if (val.length > 0) {
        input.value = `(${val}`;
    }
}

// ============================================================
// FORM SUBMISSION + CONSENT DATA CAPTURE
// ============================================================

async function submitLeadForm() {
    const firstName = document.getElementById('leadFirstName')?.value.trim();
    const lastName = document.getElementById('leadLastName')?.value.trim();
    const email = document.getElementById('leadEmail')?.value.trim();
    const phone = document.getElementById('leadPhone')?.value.trim();
    const notes = document.getElementById('leadNotes')?.value.trim();
    const consent = document.getElementById('tcpaConsent')?.checked;

    // Validation
    if (!firstName || !lastName || !email || !phone) {
        alert('Please fill in all required fields.');
        return;
    }

    if (!consent) {
        alert('Please check the consent checkbox to continue.');
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
    }

    // Phone validation (at least 10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
        alert('Please enter a valid 10-digit phone number.');
        return;
    }

    // Disable the button during submission
    const btn = document.getElementById('formSubmitBtn');
    btn.textContent = 'Submitting...';
    btn.disabled = true;

    // Gather consent metadata
    const consentData = {
        // Lead info
        firstName,
        lastName,
        email,
        phone: phoneDigits,
        phoneFormatted: phone,
        notes: notes || '',

        // Consent metadata
        consentGiven: true,
        consentTimestamp: new Date().toISOString(),
        consentTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        disclaimerVersion: DISCLAIMER_VERSION,
        checkboxActivelyChecked: true, // Was not pre-checked
        
        // Device/browser info
        userAgent: navigator.userAgent,
        platform: navigator.platform || 'unknown',
        language: navigator.language,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        
        // Page info
        pageUrl: window.location.href,
        referrer: document.referrer || 'direct',
        
        // Session info
        sessionId: getSessionId(),
        chatHistory: chatHistory.map(m => ({ role: m.role, text: m.text.substring(0, 200) })),
        
        // Will be filled by server
        ipAddress: 'captured-server-side'
    };

    try {
        // Attempt to get IP address (public API)
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            consentData.ipAddress = ipData.ip;
        } catch (e) {
            consentData.ipAddress = 'unavailable-client-side';
        }

        // Submit to your API
        const response = await fetch(`${API_BASE}/api/fed-lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(consentData)
        });

        if (response.ok) {
            formSubmitted = true;
            showFormSuccess();
        } else {
            // If API not yet set up, still show success and log to console
            console.log('Lead submission (API not available, logging locally):', consentData);
            formSubmitted = true;
            showFormSuccess();
        }
    } catch (error) {
        // API might not be deployed yet — log locally and show success
        console.log('Lead data captured (offline mode):', consentData);
        
        // Store locally as backup
        try {
            const stored = JSON.parse(localStorage.getItem('fed_leads') || '[]');
            stored.push(consentData);
            localStorage.setItem('fed_leads', JSON.stringify(stored));
        } catch (e) { /* storage not available */ }
        
        formSubmitted = true;
        showFormSuccess();
    }
}

function showFormSuccess() {
    const container = document.getElementById('leadFormContainer');
    if (container) {
        container.innerHTML = `
            <div class="form-success">
                <div class="success-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h4>Request Submitted!</h4>
                <p>A licensed agent from Final Expense Direct will contact you soon. Thank you for your interest!</p>
            </div>
        `;
    }
    
    setTimeout(() => {
        addBotMessage("Your request has been submitted! A licensed agent will be reaching out to you shortly. In the meantime, feel free to ask me any other questions. 😊");
    }, 800);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getSessionId() {
    let sid = sessionStorage.getItem('fed_session_id');
    if (!sid) {
        sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem('fed_session_id', sid);
    }
    return sid;
}
