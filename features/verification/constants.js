const VERIFY_CHANNEL_ID = '1414628197290606633';
const STAFF_REVIEW_CHANNEL_ID = '1162396891200376942';
const MEMBER_ROLE_ID = '694921356206145728';

const VERIFY_BUTTON_ID = 'verification:start';
const REVIEW_ACCEPT_BUTTON_PREFIX = 'verification:accept:';
const REVIEW_DENY_BUTTON_PREFIX = 'verification:deny:';
const MODAL_ID = 'verification:modal';

const VERIFICATION_EMBED_TITLE = 'Socials Verification';

const INVITE_SOURCE_LABELS = {
  old_master: 'Old master invite',
  new_master: 'Master invite',
  disboard: 'Disboard',
  vanity: 'Vanity URL',
  unknown: 'Unknown invite',
};

const MODAL_QUESTIONS_BY_SOURCE = {
  new_master: [
    { id: 'source_server', label: 'Which server did you join from?' },
  ],
  old_master: [
    { id: 'source_server', label: 'Which server did you join from?' },
  ],
  vanity: [
    { id: 'invited_by', label: 'Who invited you?' },
  ],
  disboard: [
    { id: 'found_us', label: 'How did you find us?' },
  ],
  unknown: [
    { id: 'invited_by', label: 'Who invited you to the server?' },
  ],
};

module.exports = {
  VERIFY_CHANNEL_ID,
  STAFF_REVIEW_CHANNEL_ID,
  MEMBER_ROLE_ID,
  VERIFY_BUTTON_ID,
  REVIEW_ACCEPT_BUTTON_PREFIX,
  REVIEW_DENY_BUTTON_PREFIX,
  MODAL_ID,
  VERIFICATION_EMBED_TITLE,
  INVITE_SOURCE_LABELS,
  MODAL_QUESTIONS_BY_SOURCE,
};
