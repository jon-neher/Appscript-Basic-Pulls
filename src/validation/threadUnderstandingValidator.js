/*
  * Lightweight runtime schema validation for the LLM thread understanding
  * output.  Throws a descriptive **Error** if any required property is
  * missing or malformed.
  *
  * The function purposefully keeps logic trivial (no AJV or Joi dependencies)
  * to remain compatible with Apps Script.  Extend with stricter checks as
  * needed.
  */

(function (global) {
   'use strict';

   /**
    * @typedef {import('../llm/apiWrapper.js').LLMResponse} LLMResponse
    */

   /**
    * Validate that an object matches the LLMResponse contract.
    *
    * @param {any} obj
    * @throws {Error} When validation fails.
    * @return {void}
    */
   function validateThreadUnderstanding(obj) {
     if (typeof obj !== 'object' || obj === null) {
       throw new Error('LLM response must be an object.');
     }

     // topic – non-empty string
     if (typeof obj.topic !== 'string' || obj.topic.trim() === '') {
       throw new Error('topic must be a non-empty string.');
     }

     // questionType – allowed enums
     const validTypes = ['clarifying', 'new', 'follow-up', 'bug', 'other'];
     if (!validTypes.includes(obj.questionType)) {
       throw new Error('questionType must be one of ' + validTypes.join(', '));
     }

     // technicalLevel – 1–4 integer
     if (
       typeof obj.technicalLevel !== 'number' ||
       !Number.isInteger(obj.technicalLevel) ||
       obj.technicalLevel < 1 ||
       obj.technicalLevel > 4
     ) {
       throw new Error('technicalLevel must be an integer 1–4.');
     }

     // urgency – 0–100 integer
     if (
       typeof obj.urgency !== 'number' ||
       !Number.isInteger(obj.urgency) ||
       obj.urgency < 0 ||
       obj.urgency > 100
     ) {
       throw new Error('urgency must be an integer between 0 and 100.');
     }

     // keyConcepts – array of strings, ≤ 10 entries
     if (!Array.isArray(obj.keyConcepts)) {
       throw new Error('keyConcepts must be an array.');
     }
     if (obj.keyConcepts.length > 10) {
       throw new Error('keyConcepts may contain up to 10 items.');
     }
     obj.keyConcepts.forEach((k, idx) => {
       if (typeof k !== 'string' || k.trim() === '') {
         throw new Error('keyConcepts[' + idx + '] must be a non-empty string.');
       }
     });
   }

   // Attach to global and CommonJS exports.
   global.validateThreadUnderstanding = validateThreadUnderstanding;

   if (typeof module !== 'undefined' && module.exports) {
     module.exports = { validateThreadUnderstanding };
   }
})(typeof globalThis !== 'undefined' ? globalThis : this);
