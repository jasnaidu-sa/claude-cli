/**
 * Formats a Date object as "dd/mm/yyyy"
 * @param date - The date to format
 * @returns Formatted date string in dd/mm/yyyy format
 */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}
