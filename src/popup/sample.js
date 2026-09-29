/*
 * A built-in example comment for the "Try a sample comment" button, so you
 * can check your voice profile and API key without opening LinkedIn.
 * It uses the same shape the content script reads from a real comment.
 */
(function (root) {
  'use strict';
  const CSB = (root.CSB = root.CSB || {});

  CSB.SAMPLE_CONTEXT = {
    post: {
      author: 'Shahran Ahmed',
      text:
        "We just wrapped a 60-second AI film for a heritage tea brand. The tools got us 70% of the way in a week. " +
        'The last 30% (the pause before the pour, the grain on the hands, the edit that lets it breathe) was all direction. ' +
        'Tools are getting cheaper. Taste is not.',
    },
    comment: {
      author: 'Priya Nair',
      headline: 'Head of Marketing at a D2C skincare brand',
      text:
        'This is stunning, the pause before the pour got me. We have a product launch in March and want something with this feel. ' +
        'What would a 30-second film like this roughly cost?',
      isReply: false,
    },
    thread: [],
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
