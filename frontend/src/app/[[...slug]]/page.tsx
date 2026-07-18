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

    // Add empty slug for home page (index.md)
    paramsList.push({ slug: [] });

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
  const slug = resolvedParams.slug || [];

  if (slug.length === 0) {
    return {
      title: 'LLM Wiki Betreuungsrecht',
      description: 'Wissensdatenbank Betreuungsrecht als Recherchetool für die tägliche Arbeit als Berufsbetreuer:in.'
    };
  }

  const page = getPageBySlug(slug);
  if (!page) {
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
  const slug = resolvedParams.slug || [];
  
  let pageTitle = '';
  let category = '';
  let htmlContent = '';
  let backlinks: string[] = [];
  let frontmatter: Record<string, any> = {};

  if (slug.length === 0) {
    // Render home page (index.md at root)
    const WIKI_ROOT = process.env.WIKI_CONTENT_PATH 
      ? path.resolve(process.env.WIKI_CONTENT_PATH) 
      : '/Users/sebastian/Sites/LLM-WIKI.public';
    const indexPath = path.join(WIKI_ROOT, 'index.md');
    
    if (!fs.existsSync(indexPath)) {
      notFound();
    }
    
    const fileContent = fs.readFileSync(indexPath, 'utf-8');
    const { data, content } = matter(fileContent);
    const lookup = buildPageLookupMap();
    
    pageTitle = data.title || 'LLM Wiki Betreuungsrecht';
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
              🏠 Startseite
            </Link>
          </li>
          <li>
            <Link href="/aktuelles" className={`sidebar-link ${category === 'aktuelles' ? 'active' : ''}`}>
              📅 Aktuelles
            </Link>
          </li>
          <li>
            <Link href="/themen" className={`sidebar-link ${category === 'themen' ? 'active' : ''}`}>
              🗂️ Themen
            </Link>
          </li>
          <li>
            <Link href="/gesetze" className={`sidebar-link ${category === 'gesetze' ? 'active' : ''}`}>
              ⚖️ Gesetze
            </Link>
          </li>
          <li>
            <Link href="/rechtsprechung" className={`sidebar-link ${category === 'rechtsprechung' ? 'active' : ''}`}>
              🏛️ Rechtsprechung
            </Link>
          </li>
          <li>
            <Link href="/glossar" className={`sidebar-link ${category === 'glossar' ? 'active' : ''}`}>
              📖 Glossar
            </Link>
          </li>
          <li>
            <Link href="/sachkunde" className={`sidebar-link ${category === 'sachkunde' ? 'active' : ''}`}>
              🎓 Sachkunde
            </Link>
          </li>
          <li>
            <Link href="/fachliteratur" className={`sidebar-link ${category === 'fachliteratur' ? 'active' : ''}`}>
              📚 Fachliteratur
            </Link>
          </li>
        </ul>

        {frontmatter.human_verified && (
          <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <strong>Status:</strong> {frontmatter.human_verified === 'yes' ? '✅ Geprüft' : '⚠️ Ungeprüft'}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="content-area" id="main-content">
        <article className="article-card">
          <span className="wiki-category">{category}</span>
          <h1 className="wiki-title">{pageTitle}</h1>
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
