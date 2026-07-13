// Shared enums/constants for application processing progress stages.

const JOB_STAGES = [
  { key: 'queued', progress: 5 },
  { key: 'uploading', progress: 30 },
  { key: 'saving_to_db', progress: 45 },
  { key: 'generating_pdf', progress: 60 },
  { key: 'bundling_zip', progress: 75 },
  { key: 'sending_email', progress: 88 },
  { key: 'done', progress: 100 },
  { key: 'failed', progress: 100 },
];

function stageToProgress(stageKey) {
  const found = JOB_STAGES.find(s => s.key === stageKey);
  return found ? found.progress : 0;
}

module.exports = { JOB_STAGES, stageToProgress };

