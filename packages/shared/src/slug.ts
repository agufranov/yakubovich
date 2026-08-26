/**
 * Слаг лота для URL. `id` — это `${sourceCode}:${externalId}`, а двоеточие
 * нельзя положить в имя файла (статический экспорт кладет каждую карточку в
 * `lot/<slug>/index.html`, на Windows такое имя невалидно). Меняем на `--`:
 * externalId у ГИС Торги — цифры и `_`, коллизий не создает.
 */
export function lotSlug(id: string): string {
  return id.replace(':', '--');
}

export function lotIdFromSlug(slug: string): string {
  return decodeURIComponent(slug).replace('--', ':');
}
