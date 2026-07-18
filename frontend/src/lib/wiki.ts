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
        if (i > 0 && nameWithoutExt.toLowerCase() === parts[i - 1].toLowerCase()) {
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

    if (!cleanTargetName) {
      return `<a href="${section}">${alias}</a>`;
    }

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

function injectHeadingIds(html: string): string {
  const headingRegex = /<h([23])>([\s\S]*?)<\/h\1>/gi;
  const seenIds = new Set<string>();
  let buchCount = 0;

  let processedHtml = html.replace(headingRegex, (match, level, content) => {
    const rawText = content.replace(/<[^>]+>/g, '').trim();
    let id = slugifySection(rawText);
    
    let counter = 1;
    let uniqueId = id;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${id}-${counter}`;
      counter++;
    }
    seenIds.add(uniqueId);

    let prefix = '';
    // If it's an H2 and starts with "Buch" (case-insensitive)
    if (level === '2' && /^Buch\s+/i.test(rawText)) {
      buchCount++;
      // Prepend HR and "To Top" link for all subsequent Buch headings
      if (buchCount > 1) {
        prefix = `<hr class="chapter-divider" /><div class="to-top-container"><a href="#main-content" class="to-top-link">↑ Nach oben</a></div>\n`;
      }
    }

    return `${prefix}<h${level} id="${uniqueId}">${content}</h${level}>`;
  });

  // If we found any "Buch" headings, append HR and "To Top" link at the very end of the content
  if (buchCount > 0) {
    processedHtml += `\n<hr class="chapter-divider" /><div class="to-top-container"><a href="#main-content" class="to-top-link">↑ Nach oben</a></div>`;
  }

  return processedHtml;
}

function preprocessBlockIds(markdown: string): string {
  // Matches " ^id" at the end of a line (or before a newline/end of text)
  return markdown.replace(/\s\^([a-zA-Z0-9\-]+)(?=\s|$)/gm, ' <span id="$1" class="block-target"></span>');
}

// Parse markdown to safe HTML
export function parseWikiMarkdown(markdown: string, lookupMap: Map<string, any>): string {
  let processed = preprocessCallouts(markdown);
  processed = preprocessWikilinks(processed, lookupMap);
  processed = preprocessBlockIds(processed);
  
  const rawHtml = marked.parse(processed, { async: false }) as string;
  const htmlWithIds = injectHeadingIds(rawHtml);
  
  // Custom sanitize-html configuration to allow custom elements & attributes
  return sanitizeHtml(htmlWithIds, {
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
      'hr': ['class']
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

export interface DesignSettings {
  variables: Record<string, string>;
  customCss: string;
  googleFonts: string[];
}

export const PRESETS: Record<string, Record<string, string>> = {
  'minimalist-light': {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#fafafa',
    '--text-primary': '#18181b',
    '--text-secondary': '#52525b',
    '--text-muted': '#a1a1aa',
    '--accent-primary': '#18181b',
    '--accent-secondary': '#27272a',
    '--accent-hover': '#3f3f46',
    '--accent-bg-soft': '#f4f4f5',
    '--border-color': '#e4e4e7',
    '--border-focus': '#a1a1aa',
    '--radius-sm': '4px',
    '--radius-md': '6px',
    '--radius-lg': '8px',
    '--shadow-premium': 'none',
  },
  'sleek-dark': {
    '--bg-primary': '#09090b',
    '--bg-secondary': '#121214',
    '--text-primary': '#f4f4f5',
    '--text-secondary': '#a1a1aa',
    '--text-muted': '#71717a',
    '--accent-primary': '#f4f4f5',
    '--accent-secondary': '#a1a1aa',
    '--accent-hover': '#e4e4e7',
    '--accent-bg-soft': '#18181b',
    '--border-color': '#27272a',
    '--border-focus': '#3f3f46',
    '--radius-sm': '4px',
    '--radius-md': '8px',
    '--radius-lg': '12px',
    '--shadow-premium': '0 0 0 1px rgba(255,255,255,0.05)',
  },
  'obsidian-dark': {
    '--bg-primary': '#1e1e1e',
    '--bg-secondary': '#2a2a2a',
    '--text-primary': '#dcddde',
    '--text-secondary': '#a3a6ac',
    '--text-muted': '#72767d',
    '--accent-primary': '#7a67ee',
    '--accent-secondary': '#9a8cff',
    '--accent-hover': '#b5aaff',
    '--accent-bg-soft': '#363636',
    '--border-color': '#3a3a3a',
    '--border-focus': '#5a5a5a',
    '--radius-sm': '4px',
    '--radius-md': '4px',
    '--radius-lg': '6px',
    '--shadow-premium': 'none',
  },
  'nordic-frost': {
    '--bg-primary': '#f0f4f8',
    '--bg-secondary': '#ffffff',
    '--text-primary': '#2e3440',
    '--text-secondary': '#4c566a',
    '--text-muted': '#d8dee9',
    '--accent-primary': '#5e81ac',
    '--accent-secondary': '#81a1c1',
    '--accent-hover': '#4c566a',
    '--accent-bg-soft': '#e5e9f0',
    '--border-color': '#d8dee9',
    '--border-focus': '#88c0d0',
    '--radius-sm': '6px',
    '--radius-md': '10px',
    '--radius-lg': '16px',
  },
  'emerald-forest': {
    '--bg-primary': '#f4f6f4',
    '--bg-secondary': '#ffffff',
    '--text-primary': '#112211',
    '--text-secondary': '#2d4a36',
    '--text-muted': '#889988',
    '--accent-primary': '#1b4d3e',
    '--accent-secondary': '#2c6b56',
    '--accent-hover': '#0f3025',
    '--accent-bg-soft': '#e8f0eb',
    '--border-color': '#d0dad4',
    '--border-focus': '#88b598',
    '--radius-sm': '8px',
    '--radius-md': '12px',
    '--radius-lg': '20px',
  },
  'royal-indigo': {
    '--bg-primary': '#faf9ff',
    '--bg-secondary': '#ffffff',
    '--text-primary': '#0b001a',
    '--text-secondary': '#4d445c',
    '--text-muted': '#a79cb8',
    '--accent-primary': '#4f46e5',
    '--accent-secondary': '#7c3aed',
    '--accent-hover': '#4338ca',
    '--accent-bg-soft': '#f0eeff',
    '--border-color': '#e8e5f0',
    '--border-focus': '#c7bfe6',
    '--radius-sm': '6px',
    '--radius-md': '12px',
    '--radius-lg': '20px',
  }
};

export function getDesignSettings(): DesignSettings {
  const defaultSettings: DesignSettings = {
    variables: {},
    customCss: '',
    googleFonts: [],
  };

  // The design file can be at the root of WIKI_ROOT
  const designPath = path.join(WIKI_ROOT, 'Design.md');
  if (fs.existsSync(designPath)) {
    return parseDesignFile(designPath);
  }
  
  const lowerDesignPath = path.join(WIKI_ROOT, 'design.md');
  if (fs.existsSync(lowerDesignPath)) {
    return parseDesignFile(lowerDesignPath);
  }

  // Also check inside content folder in case it was copied to frontend/content
  const contentDesignPath = path.join(process.cwd(), 'content', 'Design.md');
  if (fs.existsSync(contentDesignPath)) {
    return parseDesignFile(contentDesignPath);
  }

  const contentDesignPathLower = path.join(process.cwd(), 'content', 'design.md');
  if (fs.existsSync(contentDesignPathLower)) {
    return parseDesignFile(contentDesignPathLower);
  }

  return defaultSettings;
}

function parseDesignFile(filePath: string): DesignSettings {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data: frontmatter, content } = matter(fileContent);
    
    const variables: Record<string, string> = {};
    const googleFonts: string[] = [];

    // Process presets first if specified
    if (frontmatter.theme_preset && PRESETS[frontmatter.theme_preset]) {
      Object.assign(variables, PRESETS[frontmatter.theme_preset]);
    }

    // Process frontmatter variables
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === 'google_fonts' && Array.isArray(value)) {
        googleFonts.push(...value.map(f => String(f)));
      } else if (key !== 'theme_preset' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        // Convert snake_case or camelCase key to CSS property (--accent-primary)
        const cssKey = '--' + key.replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        variables[cssKey] = String(value);
      }
    }
    
    // Parse custom CSS blocks from markdown content
    let customCss = '';
    const cssBlockRegex = /```css\s*([\s\S]*?)```/gi;
    let match;
    while ((match = cssBlockRegex.exec(content)) !== null) {
      customCss += match[1] + '\n';
    }
    
    return { variables, customCss, googleFonts };
  } catch (e) {
    console.error('Error parsing design file:', e);
    return { variables: {}, customCss: '', googleFonts: [] };
  }
}

