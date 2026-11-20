/** "1234567890" -> "123 456 7890" */
export const formatMeetingCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}`;
