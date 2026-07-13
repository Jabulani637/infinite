let currentStep = 1;
const LATE_PAYMENT_PENALTY = 150;
const SERVICE_FEE_RATE = 0.02;
const STORAGE_KEYS = {
  PROGRESS: 'infinite_loan_progress',
  PROFILE: 'infinite_verified_profile'
};

let uploadedFiles = {}; // Store actual File objects

function goStep(n) {
  if (n > currentStep) return;
  setStep(n);
}

function nextStep(n) {
  if (validateStep(n)) {
    setStep(n + 1);
  }
}

function validateStep(n) {
  const stepEl = document.getElementById('step' + n);
  const fields = stepEl.querySelectorAll('.field');
  let isValid = true;

  fields.forEach(field => {
    const isRequired = field.querySelector('.required');
    const input = field.querySelector('input, select, textarea');
    if (!input) return;

    let isFieldInvalid = false;
    if (isRequired && !input.value.trim()) isFieldInvalid = true;

    // Specific South African ID length, format, and Luhn validation
    if (input.id === 'idNumber' && input.value.trim()) {
      // Primary applicant ID validation
      const idRegex = /^\d{13}$/;
      const idVal = input.value.trim();
      if (!idRegex.test(idVal) || !isValidLuhn(idVal)) isFieldInvalid = true;
    }

    // Email format validation
    if (input.type === 'email' && input.value.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(input.value.trim())) isFieldInvalid = true;
    }

    // Phone number format validation (10 digits starting with 0, or +27 format)
    if (input.type === 'tel' && input.value.trim()) {
      const telVal = input.value.trim().replace(/\s/g, ''); // Remove spaces for checking
      const telRegex = /^(?:\+27\d{9}|0\d{9})$/;
      if (!telRegex.test(telVal)) isFieldInvalid = true;
    }
    
    // Guarantor ID validation (Luhn check)
    if (input.id === 'guarantorId' && input.value.trim()) {
      const idRegex = /^\d{13}$/;
      const idVal = input.value.trim();
      if (!idRegex.test(idVal) || !isValidLuhn(idVal)) isFieldInvalid = true;
    }

    if (isFieldInvalid) {
      isValid = false;
      input.style.borderColor = 'var(--danger)';
      input.addEventListener('input', () => { input.style.borderColor = ''; }, { once: true });
    }
  });

  // Cross-check ID and Date of Birth
  const idInput = stepEl.querySelector('#idNumber');
  const dobInput = stepEl.querySelector('#dob');
  if (isValid && idInput && dobInput && idInput.value.length === 13 && dobInput.value) {
    const idDatePart = idInput.value.substring(0, 6); // YYMMDD
    const dobDatePart = dobInput.value.substring(2).replace(/-/g, ''); // YYYY-MM-DD -> YYMMDD
    if (idDatePart !== dobDatePart) {
      isValid = false;
      idInput.style.borderColor = 'var(--danger)';
      dobInput.style.borderColor = 'var(--danger)';
      alert('The Date of Birth provided does not match the birth date encoded in your ID number.');
    }
  }

  if (!isValid && !stepEl.querySelector('.alert-shown')) {
    alert('Please ensure all fields are correct. Check ID validity, email formats, and ensure phone numbers follow the +27 format.');
  }
  return isValid;
}

function prevStep(n) { setStep(n - 1); }

function setStep(n) {
  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  const steps = document.querySelectorAll('.prog-step');
  steps.forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < n) s.classList.add('done');
    else if (i + 1 === n) s.classList.add('active');
  });
  currentStep = n;
  document.getElementById('apply').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


async function submitApp() {
  console.log('🚀 submitApp() called!');
  
  try {
    const checks = ['chk1', 'chk2', 'chk3'];
    console.log('Checking declaration boxes...');
    const unchecked = checks.filter(id => {
      const el = document.getElementById(id);
      console.log(`Checkbox ${id}:`, el ? el.checked : 'NOT FOUND');
      return el && el.type === 'checkbox' && !el.checked;
    });

    if (unchecked.length > 0) {
      alert('Please check all declaration boxes before submitting.');
      return;
    }

    const ref = 'INF-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    console.log('Reference number:', ref);

    // Calculate final numbers to send
    const amt = parseFloat(document.getElementById('calcAmount').value) || 0;
    const months = parseInt(document.getElementById('calcMonths').value) || 1;
    const rate = amt > 1000 ? 0.40 : 0.30;
    let total = amt + (amt * rate * months) + (amt * SERVICE_FEE_RATE);
    if (isGameWon) total -= (total * 0.02);

    console.log('Building application data...');
    const appData = {
      reference_number: ref,
      first_name: document.getElementById('firstName').value,
      last_name: document.getElementById('lastName').value,
      id_number: document.getElementById('idNumber').value,
      dob: document.getElementById('dob').value,
      email: document.getElementById('email').value,
      cell_phone: document.getElementById('cellPhone').value,
      purpose: document.getElementById('purpose').value,
      bank_name: document.getElementById('bankName').value,
      bank_code: document.getElementById('bankCode').value,
      acc_num: document.getElementById('accNum').value,
      acc_type: document.getElementById('accType').value,
      description: document.getElementById('loanDescription').value,
      guarantor_name: document.getElementById('guarantorName').value,
      guarantor_id: document.getElementById('guarantorId').value,
      guarantor_phone: document.getElementById('guarantorPhone').value,
      guarantor_rel: document.getElementById('guarantorRel').value,
      popia_consent: document.getElementById('chk2').checked ? 1 : 0,
      loan_amount: amt,
      term_months: months,
      total_settlement: total,
      discount_applied: isGameWon ? 1 : 0
    };
    console.log('Application data:', appData);

    // Convert to FormData to support file uploads
    console.log('Preparing FormData with', Object.keys(uploadedFiles).length, 'files...');
    const formData = new FormData();
    Object.keys(appData).forEach(key => formData.append(key, appData[key]));
    Object.keys(uploadedFiles).forEach(key => {
      console.log('Adding file:', key, uploadedFiles[key].name);
      formData.append(key, uploadedFiles[key]);
    });

    console.log('Sending request to:', `${API_BASE_URL}/apply`);
    const response = await fetch(`${API_BASE_URL}/apply`, {
      method: 'POST',
      body: formData
    });

    console.log('Response status:', response.status);
    const result = await response.json();
    console.log('Response data:', result);

    if (result.success) {
      // Only update UI if the server successfully saved the application
      document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
      document.getElementById('refNum').textContent = ref;


      document.getElementById('successScreen').style.display = 'block';
      document.getElementById('apply').scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update local profile and clear draft
      const profile = {};
      const personalInputs = document.querySelectorAll('#step1 input, #step1 select, #step2 input, #step2 select');
      personalInputs.forEach(input => { if(input.id) profile[input.id] = input.type === 'checkbox' ? input.checked : input.value; });
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
      localStorage.removeItem(STORAGE_KEYS.PROGRESS);
    } else {
      alert('Submission failed: ' + (result.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error submitting application:', err);
    alert('Could not connect to the server. Please check your internet connection or try again later.');
  }
}


/* PROGRESS PERSISTENCE */
function saveProgress() {
  const formData = {};

  const inputs = document.querySelectorAll('#apply input, #apply select, #apply textarea');
  
  inputs.forEach((input, index) => {
    const key = input.id || `field_${index}`;
    formData[key] = input.type === 'checkbox' ? input.checked : input.value;
  });
  
  formData['currentStep'] = currentStep;
  localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(formData));
  alert('Progress saved! You can return later to complete your application.');
}

function loadProgress() {
  const draftData = localStorage.getItem(STORAGE_KEYS.PROGRESS);
  const verifiedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);

  // Priority 1: Restore a draft if the user was currently filling something out
  if (draftData) {
    const formData = JSON.parse(draftData);
    const inputs = document.querySelectorAll('#apply input, #apply select, #apply textarea');
    inputs.forEach((input, index) => {
      const key = input.id || `field_${index}`;
      if (formData[key] !== undefined) {
        if (input.type === 'checkbox') input.checked = formData[key];
        else input.value = formData[key];
      }
    });
    if (formData.currentStep) setStep(formData.currentStep);
    return;
  }

  // Priority 2: Returning User Bypass (Apply Verified Profile)
  if (verifiedProfile) {
    const data = JSON.parse(verifiedProfile);
    const banner = document.getElementById('returningUserBanner');
    if (banner) banner.style.display = 'flex';

    Object.keys(data).forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = data[id];
    });
    
    // Skip directly to Loan Details (Step 3)
    setStep(3);
  }
}

function resetForm() {
  if (confirm('Are you sure you want to clear all your progress and start over? This cannot be undone.')) {
    localStorage.removeItem(STORAGE_KEYS.PROGRESS);
    resetGame();
    window.location.reload();
  }
}

function changeAccount() {
  if (confirm('Are you sure you want to use a different account? This will clear your saved verified profile.')) {
    localStorage.removeItem(STORAGE_KEYS.PROFILE);
    localStorage.removeItem(STORAGE_KEYS.PROGRESS);
    window.location.reload();
  }
}

/* CHARACTER COUNTER */
const descTextarea = document.getElementById('loanDescription');
const charCounter = document.getElementById('charCounter');
if (descTextarea && charCounter) {
  descTextarea.addEventListener('input', () => {
    const len = descTextarea.value.length;
    charCounter.textContent = `${len} / 500`;
    charCounter.style.color = len >= 500 ? 'var(--danger)' : 'var(--text-light)';
  });
}

/* FAQ */
function toggleFaq(btn) {
  const isOpen = btn.classList.contains('open');
  document.querySelectorAll('.faq-question').forEach(q => { q.classList.remove('open'); q.nextElementSibling.classList.remove('open'); });
  if (!isOpen) { btn.classList.add('open'); btn.nextElementSibling.classList.add('open'); }
}

/* DOWNLOAD SIMULATION */
function simulateDownload(btn, filename) {
  const orig = btn.innerHTML;
  btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round"><path d="M20 6L9 17l-5-5"/></svg> Downloaded';
  btn.style.color = '#1A6B3C'; btn.style.borderColor = '#A3D5B7'; btn.style.background = '#EBF5EF';
  setTimeout(() => { btn.innerHTML = orig; btn.style = ''; }, 3000);
}

/* MOBILE MENU */
function initMobileMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    nav.classList.toggle('active');
    document.body.style.overflow = nav.classList.contains('active') ? 'hidden' : '';
  });

  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('active');
      nav.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

/* NEW CALCULATOR & GAME LOGIC */
let targetNumber;
let attempts;
let isGameWon;

function resetGame() {
  targetNumber = Math.floor(Math.random() * 10) + 1;
  attempts = 0;
  isGameWon = false;

  const status = document.getElementById('guessStatus');
  const btn = document.getElementById('guessBtn');
  const input = document.getElementById('guessInput');
  if (status) status.textContent = "";
  if (btn) btn.disabled = false;
  if (input) input.value = "";
  updateCalculator();
}

function updateCalculator() {
  const amountInput = document.getElementById('calcAmount');
  const monthsInput = document.getElementById('calcMonths');
  if (!amountInput || !monthsInput) return;

  let amt = parseFloat(amountInput.value) || 0;
  let months = parseInt(monthsInput.value) || 1;

  // Enforce limits
  if (months > 3) months = 3;
  if (months < 1) months = 1;

  // Interest Logic
  const rate = amt > 1000 ? 0.40 : 0.30;
  const interest = amt * rate * months;
  const serviceFee = amt * SERVICE_FEE_RATE;
  
  let total = amt + interest + serviceFee;
  let discount = 0;

  if (isGameWon) {
    discount = total * 0.02;
    total -= discount;
  }

  const monthly = months > 0 ? total / months : total;

  // Update UI
  document.getElementById('resRate').textContent = (rate * 100) + '%';
  document.getElementById('resInterest').textContent = 'R ' + interest.toFixed(2);
  document.getElementById('resDiscount').textContent = '- R ' + discount.toFixed(2);
  document.getElementById('resTotal').textContent = 'R ' + total.toFixed(2);

  const monthlyEl = document.getElementById('resMonthly');
  if (monthlyEl) {
    monthlyEl.textContent = 'R ' + monthly.toFixed(2);
    
    // Visually highlight the installment if the user has won the discount
    if (isGameWon) {
      monthlyEl.style.color = 'var(--success)';
      monthlyEl.style.fontWeight = '700';
    } else {
      monthlyEl.style.color = '';
      monthlyEl.style.fontWeight = '';
    }
  }
}

function handleGuess() {
  const input = document.getElementById('guessInput');
  const status = document.getElementById('guessStatus');
  const btn = document.getElementById('guessBtn');
  
  if (isGameWon || attempts >= 3) return;

  const guess = parseInt(input.value);
  attempts++;

  if (guess === targetNumber) {
    isGameWon = true;
    status.textContent = "CORRECT! 2% discount applied.";
    status.style.color = "var(--success)";
    btn.disabled = true;
    updateCalculator();
  } else {
    if (attempts >= 3) {
      status.textContent = `No attempts left. The number was ${targetNumber}.`;
      btn.disabled = true;
    } else {
      status.textContent = `Wrong! ${3 - attempts} attempts left.`;
    }
  }
  input.value = '';
}

const calcAmountEl = document.getElementById('calcAmount');
const calcMonthsEl = document.getElementById('calcMonths');
const guessBtnEl = document.getElementById('guessBtn');

if (calcAmountEl) calcAmountEl.addEventListener('input', updateCalculator);
if (calcMonthsEl) calcMonthsEl.addEventListener('input', updateCalculator);
if (guessBtnEl) guessBtnEl.addEventListener('click', handleGuess);

// Initialize calculation
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('calcAmount')) resetGame();
});

/* WHATSAPP INTEGRATION */
async function initWhatsApp() {
  const waBtn = document.createElement('a');
  waBtn.className = "whatsapp-fab";
  waBtn.target = "_blank";
  waBtn.setAttribute('aria-label', 'Chat with us on WhatsApp');
  waBtn.innerHTML = `
    <span class="wa-chat-label" id="waChatLabel">Chat now</span>
    <span class="wa-tooltip" id="waTooltip">Need help?</span>
    <svg style="width:32px;height:32px;fill:currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>`;

  let adminNumbers = ["27682749288"]; // fallback
  try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      const data = await res.json();
      if (data.success && data.data.whatsapp_number) {
          adminNumbers = data.data.whatsapp_number.split(',').map(num => num.trim()).filter(num => num.length > 0);
          if (adminNumbers.length === 0) {
              adminNumbers = ["27682749288"];
          }
      }
  } catch (e) {
      console.error('Failed to fetch WhatsApp numbers:', e);
  }

  const updateWhatsAppLink = () => {
    const tooltip = document.getElementById('waTooltip');
    const fName = document.getElementById('firstName')?.value.trim() || "";
    const lName = document.getElementById('lastName')?.value.trim() || "";
    const nameStr = (fName || lName) ? ` My name is ${fName} ${lName}.` : "";
    
    const randomIdx = Math.floor(Math.random() * adminNumbers.length);
    const selectedNumber = adminNumbers[randomIdx];
    
    const baseMessage = "Hello, I have a question regarding the Infinite loan application.";
    waBtn.href = `https://wa.me/${selectedNumber}?text=${encodeURIComponent(baseMessage + nameStr)}`;
  };

  // Update the link whenever the user interacts with the button or name fields
  waBtn.addEventListener('mouseenter', updateWhatsAppLink);
  waBtn.addEventListener('click', updateWhatsAppLink);
  
  // Update when name fields change
  const firstNameInput = document.getElementById('firstName');
  const lastNameInput = document.getElementById('lastName');
  if (firstNameInput) firstNameInput.addEventListener('input', updateWhatsAppLink);
  if (lastNameInput) lastNameInput.addEventListener('input', updateWhatsAppLink);

  updateWhatsAppLink(); // Set initial link
  document.body.appendChild(waBtn);

  // Remove the 'Chat now' label after 5 seconds
  setTimeout(() => {
    const label = document.getElementById('waChatLabel');
    if (label) {
      label.style.opacity = '0';
      setTimeout(() => label.remove(), 500);
    }
  }, 5000);
}

/* FILE UPLOAD */
const docTags = ['tag-id', 'tag-student-card', 'tag-registration', 'tag-bank', 'tag-selfie', 'tag-nsfas', 'tag-address'];
let uploadedCount = 0;

function handleUpload(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    if (file.size > 5 * 1024 * 1024) { alert(file.name + ' exceeds 5MB limit.'); return; }

    // Find the first tag that doesn't have a file yet
    const tagId = docTags.find(tag => !uploadedFiles[tag]);
    if (tagId) {
      uploadedFiles[tagId] = file; // Store the file
      addUploadItem(file, tagId);
      const tag = document.getElementById(tagId);
      if (tag) {
        tag.classList.remove('pending');
        tag.classList.add('done');
        uploadedCount++;
      }
    }
  });
  input.value = '';
}

function addUploadItem(file, tagId) {
  const list = document.getElementById('uploadList');
  if (!list) return;
  const ext = file.name.split('.').pop().toUpperCase();
  const size = (file.size / 1024).toFixed(0) + ' KB';
  const id = 'up-' + Date.now() + Math.random();
  const div = document.createElement('div');
  div.className = 'upload-item';
  div.id = id;
  div.innerHTML = `
    <div class="upload-item-left">
      <svg viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <div>
        <div class="upload-item-name">${file.name}</div>
        <div class="upload-item-size">${ext} · ${size}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="upload-status ok">✓ Uploaded</span>
      <button class="remove-upload" onclick="removeUpload('${id}', '${tagId}')" title="Remove">✕</button>
    </div>`;
  list.appendChild(div);
}

function removeUpload(id, tagId) {
  const el = document.getElementById(id);
  if (el) { 
    el.remove();
    delete uploadedFiles[tagId];
    uploadedCount = Object.keys(uploadedFiles).length;

    const tag = document.getElementById(tagId);
    if (tag) {
      tag.classList.remove('done');
      tag.classList.add('pending');
    }
  }
}

/* DRAG & DROP */
const zone = document.querySelector('.upload-zone');
if (zone) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--gold)'; zone.style.background = 'var(--gold-pale)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; zone.style.background = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = ''; zone.style.background = '';
    const input = document.getElementById('fileInput');
    if (!input) return;
    const dt = new DataTransfer();
    Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
    input.files = dt.files;
    handleUpload(input);
  });
}

/**
 * Validates a string using the Luhn Algorithm
 * @param {string} id - The 13 digit SA ID number
 */
function isValidLuhn(id) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    let digit = parseInt(id.charAt(i));
    if (i % 2 === 0) {
      sum += digit;
    } else {
      let double = digit * 2;
      sum += (double > 9) ? (double - 9) : double;
    }
  }
  return (sum % 10 === 0);
}

/* URGENCY TIMER */
function initUrgencyTimer() {
  let time = 600; // 10 minutes in seconds
  const display = document.getElementById('timer');
  if (!display) return;
  
  setInterval(() => {
    const mins = Math.floor(time / 60);
    const secs = time % 60;
    display.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (time > 0) time--;
  }, 1000);
}

// Initialize progress on load
document.addEventListener('DOMContentLoaded', () => {
  loadProgress();
  initWhatsApp();
  initMobileMenu();
  initUrgencyTimer();
});