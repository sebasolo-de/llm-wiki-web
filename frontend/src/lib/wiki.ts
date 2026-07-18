import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Determine the wiki content root directory
const WIKI_ROOT = process.env.WIKI_CONTENT_PATH 
  ? path.resolve(process.env.WIKI_CONTENT_PATH) 
  : '/Users/sebastian/Sites/LLM-WIKI.public';

export interface WikiPage {
  slug: string[];
  title: string;
  category: string;
  content: string;
  htmlContent: string;
  frontmatter: Record<string, any>;
  backlinks: string[];
}

export interface SearchIndexEntry {
  title: string;
  url: string;
  category: string;
  excerpt: string;
}

// Global cache for page lookup map
let pageLookupCache: Map<string, { url: string; absPath: string; category: string; title: string }> | null = null;

// Recursively find all files in a directory
function getFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.map((entry) => {
    const res = path.resolve(dir, entry.name);
    return entry.isDirectory() ? getFilesRecursive(res) : res;
  });
  return Array.prototype.concat(...files);
}

export function slugifyUrlSegment(segment: string): string {
  return segment
    .toLowerCase()
    .trim()
    // Replace spaces and typical URL-unfriendly characters with hyphens
    .replace(/[\s\(\)\/\\&,:\.\?]+/g, '-')
    // Collapse consecutive hyphens
    .replace(/-+/g, '-')
    // Remove leading and trailing hyphens
    .replace(/^-+|-+$/g, '');
}

// Build a map from lowercase filename (and paths) to relative URLs
export function buildPageLookupMap(force = false) {
  const isDev = process.env.NODE_ENV === 'development';
  if (pageLookupCache && !force && !isDev) {
    return pageLookupCache;
  }

  const lookup = new Map<string, { url: string; absPath: string; category: string; title: string }>();
  const wikiDir = path.join(WIKI_ROOT, 'wiki');

  if (!fs.existsSync(wikiDir)) {
    console.warn(`Wiki directory not found at: ${wikiDir}`);
    pageLookupCache = lookup;
    return lookup;
  }

  const mdFiles = getFilesRecursive(wikiDir).filter((f) => f.endsWith('.md'));

  for (const absPath of mdFiles) {
    const relPath = path.relative(wikiDir, absPath);
    // Split paths
    const parts = relPath.split(path.sep);
    if (parts.length === 0) continue;

    const firstDir = parts[0];
    const category = firstDir.replace(/^\d{2}_/, '').toLowerCase();
    
    // Build URL segments
    const urlSegments = [category];
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // Last part: remove .md extension
        const nameWithoutExt = path.basename(part, '.md');
        // Folder notes (e.g. BGB/BGB.md) should be served at BGB/ rather than BGB/BGB
        if (i > 1 && nameWithoutExt.toLowerCase() === parts[i - 1].toLowerCase()) {
          // Do not append duplicate name
        } else {
          urlSegments.push(nameWithoutExt);
        }
      } else {
        urlSegments.push(part);
      }
    }

    const url = '/' + urlSegments.map(s => slugifyUrlSegment(s)).join('/');
    const basename = path.basename(relPath, '.md');
    const lowercaseBasename = basename.toLowerCase();
    const lowercaseRelPath = relPath.replace(/\.md$/, '').toLowerCase().replace(/\\/g, '/');

    const entry = {
      url,
      absPath,
      category,
      title: basename.replace(/_/g, ' '),
    };

    // Index by simple basename (Obsidian style)
    if (!lookup.has(lowercaseBasename)) {
      lookup.set(lowercaseBasename, entry);
    }
    
    // Index by relative path (Obsidian qualified style)
    lookup.set(lowercaseRelPath, entry);
    lookup.set(`wiki/${lowercaseRelPath}`, entry);
  }

  pageLookupCache = lookup;
  return lookup;
}

// Format Obsidian Callouts
function preprocessCallouts(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let inCallout = false;
  let calloutType = '';
  let calloutTitle = '';
  let calloutContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^>\s*\[!([a-zA-Z0-9_\-]+)\]([\+\-])?\s*(.*)$/);

    if (match) {
      if (inCallout) {
        result.push(renderCallout(calloutType, calloutTitle, calloutContent.join('\n')));
        calloutContent = [];
      }
      inCallout = true;
      calloutType = match[1].toLowerCase();
      calloutTitle = match[3].trim();
      if (!calloutTitle) {
        calloutTitle = calloutType.charAt(0).toUpperCase() + calloutType.slice(1);
      }
    } else if (inCallout && line.startsWith('>')) {
      calloutContent.push(line.replace(/^>\s?/, ''));
    } else {
      if (inCallout) {
        result.push(renderCallout(calloutType, calloutTitle, calloutContent.join('\n')));
        inCallout = false;
        calloutContent = [];
      }
      result.push(line);
    }
  }

  if (inCallout) {
    result.push(renderCallout(calloutType, calloutTitle, calloutContent.join('\n')));
  }

  return result.join('\n');
}

function renderCallout(type: string, title: string, content: string): string {
  return `<div class="callout callout-${type}">
<div class="callout-title">${title}</div>
<div class="callout-content">

${content}

</div>
</div>`;
}

// Convert Obsidian Wikilinks
function preprocessWikilinks(markdown: string, lookupMap: Map<string, any>): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (match, p1) => {
    const [targetPart, aliasPart] = p1.split('|');
    const [targetName, sectionPart] = targetPart.split('#');
    
    const cleanTargetName = targetName.trim();
    const alias = (aliasPart || targetPart).trim();
    const section = sectionPart ? `#${slugifySection(sectionPart)}` : '';

    const lowercaseTarget = cleanTargetName.toLowerCase().replace(/\\/g, '/');
    const entry = lookupMap.get(lowercaseTarget);

    if (entry) {
      return `<a href="${entry.url}${section}">${alias}</a>`;
    } else {
      // Parse raw paths
      if (cleanTargetName.startsWith('raw/public/Rechtsprechung/')) {
        const relativeRawPath = cleanTargetName.replace('raw/public/Rechtsprechung/', '');
        return `<a href="/rechtsprechung/raw/${relativeRawPath}${section}">${alias}</a>`;
      }
      if (cleanTargetName.startsWith('raw/public/Gesetze & Co/')) {
        const relativeRawPath = cleanTargetName.replace('raw/public/Gesetze & Co/', '');
        return `<a href="/gesetze/raw/${relativeRawPath}${section}">${alias}</a>`;
      }
      return `<span class="wiki-link-stub" title="Nicht vorhanden: ${cleanTargetName}">${alias}</span>`;
    }
  });
}

function slugifySection(section: string): string {
  return section.trim().toLowerCase().replace(/[^a-z0-9\u00e0-\u00fc]+/g, '-').replace(/(^-|-$)/g, '');
}

// Parse markdown to safe HTML
export function parseWikiMarkdown(markdown: string, lookupMap: Map<string, any>): string {
  let processed = preprocessCallouts(markdown);
  processed = preprocessWikilinks(processed, lookupMap);
  
  const rawHtml = marked.parse(processed, { async: false }) as string;
  
  // Custom sanitize-html configuration to allow custom elements & attributes
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'div', 'span', 'details', 'summary', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'div': ['class', 'id'],
      'span': ['class', 'title', 'id'],
      'a': ['href', 'title', 'class'],
      'h1': ['id'],
      'h2': ['id'],
      'h3': ['id'],
      'h4': ['id'],
    }
  });
}

// Load a specific page by its slug segments
export function getPageBySlug(slug: string[]): WikiPage | null {
  const lookup = buildPageLookupMap();
  const lowercasePath = slug.join('/').toLowerCase();
  
  // Find in lookup map
  let foundKey = '';
  for (const [key, value] of lookup.entries()) {
    if (value.url.toLowerCase().substring(1) === lowercasePath) {
      foundKey = key;
      break;
    }
  }

  if (!foundKey) return null;
  const entry = lookup.get(foundKey)!;

  if (!fs.existsSync(entry.absPath)) return null;

  const fileContent = fs.readFileSync(entry.absPath, 'utf-8');
  const { data: frontmatter, content } = matter(fileContent);

  // Simple backlink extraction: find files in the lookup map that contain links to this page's basename
  const basename = path.basename(entry.absPath, '.md');
  const backlinks: string[] = [];
  
  // For performance, we can skip full backlink parsing on every request, but here is a simple regex search
  const linkRegex = new RegExp(`\\[\\[([^\\]\\|#]*)${basename}([#\\|][^\\]]*)?\\]\\]`, 'i');
  
  for (const [key, val] of lookup.entries()) {
    // Only search using unique absolute paths
    if (key.includes('/') && fs.existsSync(val.absPath) && val.absPath !== entry.absPath) {
      const otherContent = fs.readFileSync(val.absPath, 'utf-8');
      if (linkRegex.test(otherContent)) {
        backlinks.push(val.url);
      }
    }
  }

  // Filter out duplicate backlinks
  const uniqueBacklinks = Array.from(new Set(backlinks));

  const htmlContent = parseWikiMarkdown(content, lookup);

  return {
    slug,
    title: frontmatter.title || entry.title,
    category: entry.category,
    content,
    htmlContent,
    frontmatter,
    backlinks: uniqueBacklinks,
  };
}

// List all pages in a specific category
export function getPagesByCategory(category: string) {
  const lookup = buildPageLookupMap();
  const pages: Array<{ title: string; url: string; absPath: string; frontmatter: any }> = [];

  for (const [key, val] of lookup.entries()) {
    // Only use the qualified path keys to avoid processing duplicates
    if (key.startsWith('wiki/') && val.category === category) {
      if (fs.existsSync(val.absPath)) {
        const fileContent = fs.readFileSync(val.absPath, 'utf-8');
        const { data: frontmatter } = matter(fileContent);
        pages.push({
          title: frontmatter.title || val.title,
          url: val.url,
          absPath: val.absPath,
          frontmatter,
        });
      }
    }
  }

  return pages;
}
