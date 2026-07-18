import React from 'react';
import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import Link from 'next/link';
import { 
  getPageBySlug, 
  buildPageLookupMap, 
  parseWikiMarkdown,
  getPagesByCategory
} from '@/lib/wiki';

// Force static rendering parameter generation
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateStaticParams() {
  try {
    const lookup = buildPageLookupMap(true);
    const paramsList: Array<{ slug: string[] }> = [];

    // Add empty slug for home page
    paramsList.push({ slug: [] });

    // Add sitemap slugs
    paramsList.push({ slug: ['sitemap'] });
    paramsList.push({ slug: ['fachliteratur', 'sitemap'] });

    // Add category slugs
    const validCategories = ['aktuelles', 'themen', 'gesetze', 'rechtsprechung', 'glossar', 'sachkunde', 'fachliteratur'];
    for (const cat of validCategories) {
      paramsList.push({ slug: [cat] });
    }

    for (const val of lookup.values()) {
      const slugParts = val.url.substring(1).split('/');
      if (slugParts.length > 0 && slugParts[0] !== '') {
        paramsList.push({ slug: slugParts });
      }
    }

    return paramsList;
  } catch (e) {
    console.error('Error generating static params', e);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps) {
  const resolvedParams = await params;
  const rawSlug = resolvedParams.slug || [];
  const slug = rawSlug.map(s => decodeURIComponent(s));

  const isSitemap = (slug.length === 1 && slug[0] === 'sitemap') || 
                    (slug.length === 2 && slug[0] === 'fachliteratur' && slug[1] === 'sitemap');

  if (isSitemap) {
    return {
      title: 'Gesamtübersicht (Sitemap) | LLM Wiki',
      description: 'Vollständige, maschinell erzeugte Übersicht aller Einträge im LLM-Wiki.'
    };
  }

  if (slug.length === 0) {
    return {
      title: 'Startseite | LLM Wiki Betreuungsrecht',
      description: 'Wissensdatenbank Betreuungsrecht als Recherchetool für die tägliche Arbeit als Berufsbetreuer:in.'
    };
  }

  const page = getPageBySlug(slug);
  if (!page) {
    const possibleCategory = slug[0].toLowerCase();
    const validCategories = ['aktuelles', 'themen', 'gesetze', 'rechtsprechung', 'glossar', 'sachkunde', 'fachliteratur'];
    if (slug.length === 1 && validCategories.includes(possibleCategory)) {
      return {
        title: `${getCategoryName(possibleCategory)} | LLM Wiki`,
        description: `Übersicht aller Einträge in der Kategorie ${getCategoryName(possibleCategory)}.`
      };
    }
    return {
      title: 'Seite nicht gefunden',
    };
  }

  return {
    title: `${page.title} | LLM Wiki`,
    description: page.frontmatter.description || `Eintrag zu ${page.title} im LLM Wiki Betreuungsrecht.`
  };
}

function getCategoryName(cat: string): string {
  const mapping: Record<string, string> = {
    aktuelles: 'Aktuelles',
    themen: 'Themen',
    gesetze: 'Gesetze',
    rechtsprechung: 'Rechtsprechung',
    glossar: 'Glossar',
    sachkunde: 'Sachkunde',
    fachliteratur: 'Fachliteratur'
  };
  return mapping[cat] || cat;
}

export default async function WikiPage({ params }: PageProps) {
  const resolvedParams = await params;
  const rawSlug = resolvedParams.slug || [];
  const slug = rawSlug.map(s => decodeURIComponent(s));
  
  let pageTitle = '';
  let category = '';
  let htmlContent = '';
  let backlinks: string[] = [];
  let frontmatter: Record<string, any> = {};

  const WIKI_ROOT = process.env.WIKI_CONTENT_PATH 
    ? path.resolve(process.env.WIKI_CONTENT_PATH) 
    : '/Users/sebastian/Sites/LLM-WIKI.public';

  const isSitemap = (slug.length === 1 && slug[0] === 'sitemap') || 
                    (slug.length === 2 && slug[0] === 'fachliteratur' && slug[1] === 'sitemap');

  if (isSitemap) {
    const indexPath = path.join(WIKI_ROOT, 'index.md');
    if (!fs.existsSync(indexPath)) {
      notFound();
    }
    const fileContent = fs.readFileSync(indexPath, 'utf-8');
    const { data, content } = matter(fileContent);
    const lookup = buildPageLookupMap();
    
    pageTitle = data.title || 'Gesamtübersicht (Sitemap)';
    category = 'fachliteratur';
    htmlContent = parseWikiMarkdown(content, lookup);
    frontmatter = data;
  } else if (slug.length === 0) {
    // Render home page (wiki/wiki.md)
    const indexPath = path.join(WIKI_ROOT, 'wiki', 'wiki.md');
    if (!fs.existsSync(indexPath)) {
      notFound();
    }
    const fileContent = fs.readFileSync(indexPath, 'utf-8');
    const { data, content } = matter(fileContent);
    const lookup = buildPageLookupMap();
    
    pageTitle = data.title || 'Startseite';
    category = 'meta';
    htmlContent = parseWikiMarkdown(content, lookup);
    frontmatter = data;
  } else {
    const page = getPageBySlug(slug);
    if (!page) {
      const possibleCategory = slug[0].toLowerCase();
      const validCategories = ['aktuelles', 'themen', 'gesetze', 'rechtsprechung', 'glossar', 'sachkunde', 'fachliteratur'];
      
      if (slug.length === 1 && validCategories.includes(possibleCategory)) {
        category = possibleCategory;
        pageTitle = getCategoryName(category);
        const pages = getPagesByCategory(category);
        pages.sort((a, b) => a.title.localeCompare(b.title));
        
        htmlContent = `
          <p>Hier finden Sie alle Einträge in der Kategorie <strong>${pageTitle}</strong>:</p>
          <ul class="category-page-list">
            ${pages.map(p => `<li><a href="${p.url}">${p.title}</a></li>`).join('')}
          </ul>
        `;
        frontmatter = { title: pageTitle };
      } else {
        notFound();
      }
    } else {
      pageTitle = page.title;
      category = page.category;
      htmlContent = page.htmlContent;
      backlinks = page.backlinks;
      frontmatter = page.frontmatter;
    }
  }

  // Generate Table of Contents (headings h2 and h3) from HTML
  const headings: Array<{ id: string; text: string; depth: number }> = [];
  const headingRegex = /<h([23])\s+id="([^"]+)">([^<]+)<\/h\1>/g;
  let match;
  while ((match = headingRegex.exec(htmlContent)) !== null) {
    headings.push({
      depth: parseInt(match[1]),
      id: match[2],
      text: match[3],
    });
  }

  return (
    <div className="main-wrapper">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-title">Kategorien</div>
        <ul className="sidebar-menu">
          <li>
            <Link href="/" className={`sidebar-link ${slug.length === 0 ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span>Startseite</span>
            </Link>
          </li>
          <li>
            <Link href="/aktuelles" className={`sidebar-link ${category === 'aktuelles' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                <line x1="16" x2="16" y1="2" y2="6"/>
                <line x1="8" x2="8" y1="2" y2="6"/>
                <line x1="3" x2="21" y1="10" y2="10"/>
              </svg>
              <span>Aktuelles</span>
            </Link>
          </li>
          <li>
            <Link href="/themen" className={`sidebar-link ${category === 'themen' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span>Themen</span>
            </Link>
          </li>
          <li>
            <Link href="/gesetze" className={`sidebar-link ${category === 'gesetze' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v17M12 5l-8 3h16l-8-3zM4 10a4 4 0 0 0 8 0M12 10a4 4 0 0 0 8 0"/>
              </svg>
              <span>Gesetze</span>
            </Link>
          </li>
          <li>
            <Link href="/rechtsprechung" className={`sidebar-link ${category === 'rechtsprechung' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M2 11l10-9 10 9M12 2v3"/>
              </svg>
              <span>Rechtsprechung</span>
            </Link>
          </li>
          <li>
            <Link href="/glossar" className={`sidebar-link ${category === 'glossar' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"/>
                <path d="M6 6h10M6 10h10M6 14h8"/>
              </svg>
              <span>Glossar</span>
            </Link>
          </li>
          <li>
            <Link href="/sachkunde" className={`sidebar-link ${category === 'sachkunde' ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
              </svg>
              <span>Sachkunde</span>
            </Link>
          </li>
          <li>
            <Link href="/fachliteratur" className={`sidebar-link ${category === 'fachliteratur' && !isSitemap ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"/>
                <path d="M6 2v20M10 2v20"/>
              </svg>
              <span>Fachliteratur</span>
            </Link>
          </li>
          <li>
            <Link href="/fachliteratur/sitemap" className={`sidebar-link ${isSitemap ? 'active' : ''}`}>
              <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
              </svg>
              <span>Gesamtübersicht (Sitemap)</span>
            </Link>
          </li>
        </ul>
      </aside>

      {/* Main Content Area */}
      <main className="content-area" id="main-content">
        <article className="article-card">
          <span className="wiki-category">{category}</span>
          <div className="wiki-meta">
            {frontmatter.version && <span>Version: {frontmatter.version}</span>}
            {frontmatter.date && <span>Stand: {frontmatter.date}</span>}
            {frontmatter.license && <span>Lizenz: {frontmatter.license}</span>}
          </div>
          <div 
            className="wiki-body" 
            dangerouslySetInnerHTML={{ __html: htmlContent }} 
          />
        </article>
      </main>

      {/* Right Sidebar (TOC & Backlinks) */}
      <aside className="right-pane">
        {headings.length > 0 && (
          <div className="pane-section">
            <div className="pane-title">Inhalt</div>
            <ul className="backlink-list" style={{ gap: '0.4rem' }}>
              {headings.map((heading, idx) => (
                <li 
                  key={idx} 
                  style={{ 
                    paddingLeft: heading.depth === 3 ? '0.75rem' : '0', 
                    fontSize: '0.85rem' 
                  }}
                >
                  <a href={`#${heading.id}`} className="nav-link" style={{ fontSize: '0.85rem' }}>
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {backlinks.length > 0 && (
          <div className="pane-section">
            <div className="pane-title">Verweise hierher</div>
            <ul className="backlink-list">
              {backlinks.map((link, idx) => (
                <li key={idx} className="backlink-item">
                  <Link href={link}>
                    {link.split('/').pop()?.replace(/_/g, ' ')}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
