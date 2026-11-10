/**
 * How long a contact took, split for the leadFollowUp.duration message ("1時間30分", "45分",
 * "2時間"; #554)
 */
export const durationParts = (minutes: number) => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});
