// A signature animation is an assertion about something that happened, not a
// decoration attached to a provider name.  These source tags contain no task
// content or identifiers: adapters may emit one only after observing the
// matching structural fact.
//
// `hook:*` is emitted by a provider's genuine lifecycle hook. `session:*` is
// emitted by the read-only Codex transcript observer. `orchestration:*` is
// reserved for a future provider-neutral orchestration adapter that can prove
// the named cross-agent fact. A generic tool, a message, or two nearby events
// never manufacture an outcome; an allowlisted command whose own name declares
// the action may instead animate that literal Tier-B action.
export const EVENT_EVIDENCE = Object.freeze({
  task_started: { sources: ['hook:task_started', 'session:task_started'], legacyTierA: true },
  agent_spawned: { sources: ['hook:subagent_started', 'orchestration:agent_spawned'], legacyTierA: true },
  agent_finished: { sources: ['hook:subagent_finished'], legacyTierA: true },
  agent_failed: { sources: ['hook:subagent_failed'], legacyTierA: true },
  agent_cancelled: { sources: ['hook:subagent_cancelled'], legacyTierA: true },
  task_interrupted: { sources: ['hook:task_interrupted', 'session:task_interrupted'], legacyTierA: true },
  task_completed: { sources: ['hook:task_completed', 'session:task_completed'], legacyTierA: true },
  owner_input_required: { sources: ['hook:owner_input_required', 'session:owner_input_required'], legacyTierA: true },
  owner_input_received: { sources: ['session:owner_input_received'], legacyTierA: false },
  delegation_requested: { sources: ['session:delegation_requested', 'orchestration:delegation_requested'], legacyTierA: false },
  coordination_message: { sources: ['session:coordination_message', 'orchestration:coordination_message'], legacyTierA: false },
  patch_apply_ended: { sources: ['session:patch_apply_ended'], legacyTierA: false },

  // A session may also carry an explicit, allowlisted command whose own name is the
  // action (for example `review_passed`).  That is a real local-record fact and can
  // animate the command.  We do not inspect command input/output, invent a result
  // from a generic tool, or promote the observation to a hook.
  acting_lead_handoff: { sources: ['orchestration:acting_lead_handoff', 'session:acting_lead_handoff'], legacyTierA: false },
  discussion_started: { sources: ['orchestration:discussion_started', 'session:discussion_started'], legacyTierA: false },
  discussion_ended: { sources: ['orchestration:discussion_ended', 'session:discussion_ended'], legacyTierA: false },
  meeting_started: { sources: ['orchestration:meeting_started', 'session:meeting_started'], legacyTierA: false },
  meeting_completed: { sources: ['orchestration:meeting_completed', 'session:meeting_completed'], legacyTierA: false },
  revision_requested: { sources: ['orchestration:revision_requested', 'session:revision_requested'], legacyTierA: false },
  review_passed: { sources: ['orchestration:review_passed', 'session:review_passed'], legacyTierA: false },
  delegated_decision_granted: { sources: ['orchestration:delegated_decision_granted', 'session:delegated_decision_granted'], legacyTierA: false },
  decision_recorded: { sources: ['orchestration:decision_recorded', 'session:decision_recorded'], legacyTierA: false }
});

export function sourceEvidenceFor(eventType) {
  return EVENT_EVIDENCE[eventType]?.sources?.[0] || '';
}

export function observationForSourceEvidence(sourceEvidence) {
  const source = String(sourceEvidence || '').trim().toLowerCase();
  if (source.startsWith('session:')) {
    return { observationTier: 'B', sourceConfidence: 'local_session_record' };
  }
  if (source.startsWith('orchestration:')) {
    return { observationTier: 'A', sourceConfidence: 'orchestration_record' };
  }
  return { observationTier: 'A', sourceConfidence: 'structured' };
}

function evidenceMatchesObservation(event, source) {
  const tier = String(event?.observationTier || '').toUpperCase();
  const confidence = String(event?.sourceConfidence || '').toLowerCase();
  if (source.startsWith('hook:')) return tier === 'A' && confidence === 'structured';
  if (source.startsWith('session:')) return tier === 'B' && confidence === 'local_session_record';
  if (source.startsWith('orchestration:')) return tier === 'A' && confidence === 'orchestration_record';
  return false;
}

export function hasVerifiedEventEvidence(event) {
  const contract = EVENT_EVIDENCE[event?.eventType];
  if (!contract) return true;
  const source = String(event?.sourceEvidence || '').trim().toLowerCase();
  if (source) return contract.sources.includes(source) && evidenceMatchesObservation(event, source);
  // Preserve animations from a previously-installed real Tier-A lifecycle
  // relay. Tier-B observations never receive this compatibility exception.
  return contract.legacyTierA === true
    && String(event?.observationTier || '').toUpperCase() === 'A'
    && String(event?.sourceConfidence || '').toLowerCase() !== 'local_session_record';
}

export function isAnimationEvidenceEligible(event) {
  return event?.animationEligible !== false && hasVerifiedEventEvidence(event);
}
