const otpMap = new Map();

const setOtp = (email, code, ttlMs) => {
  otpMap.set(email, {
    code,
    expiresAt: Date.now() + ttlMs
  });
};

const verifyOtp = (email, code) => {
  const entry = otpMap.get(email);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpMap.delete(email);
    return false;
  }
  const match = entry.code === code;
  if (match) {
    otpMap.delete(email);
  }
  return match;
};

module.exports = {
  setOtp,
  verifyOtp
};

