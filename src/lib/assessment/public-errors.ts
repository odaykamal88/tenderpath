/**
 * Public assessment failures must never expose provider responses, request
 * identifiers, billing state, or stack details. The raw failure remains in
 * `assessments.assessment_error` and server logs for operators.
 */
export const PUBLIC_ASSESSMENT_ERROR =
  "We couldn't complete the assessment. Please try again shortly.";

export const PUBLIC_ASSESSMENT_ERROR_CODE = "ASSESSMENT_PROCESSOR_UNAVAILABLE";
