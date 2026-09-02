import { GENRES, GENRE_ORDER } from './genres/index.js';

(function(){
  "use strict";

  function scaleValues(){
    const vals = [];
    for(let v = 0; v <= 5; v += 1) vals.push(v);
    return vals;
  }
  const SCALE = scaleValues();

  let metaTitle = '';
  let metaAuthor = '';
  let selectedScalePrecision = 0.25;
  let coverDebounce = null;

  const coverContainer = document.getElementById('coverContainer');
  const coverImg = document.getElementById('coverImg');

  coverImg.onload = () => {
    if (coverImg.getAttribute('src')) {
      coverContainer.classList.add('has-image');
    }
  };

  coverImg.onerror = () => {
    hideCover();
  };

  function showCover(url) {
    coverImg.src = url;
  }

  function hideCover() {
    coverImg.removeAttribute('src');
    coverContainer.classList.remove('has-image');
  }

  function normalizeTitle(str) {
    return str ? str.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\s+/g, ' ').trim() : '';
  }

  async function fetchBookCover(title, author) {
    const cleanTitle = title ? title.trim() : '';
    if (!cleanTitle) {
      hideCover();
      return;
    }

    const normTargetTitle = normalizeTitle(cleanTitle);
    const query = encodeURIComponent(`${cleanTitle} ${author ? author.trim() : ''}`.trim());

    try {
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`);
      if (res.ok) {
        const data = await res.json();
        const item = data.items?.[0];
        const fetchedTitle = item?.volumeInfo?.title || '';
        const imgUrl = item?.volumeInfo?.imageLinks?.thumbnail || item?.volumeInfo?.imageLinks?.smallThumbnail;

        if (imgUrl && normalizeTitle(fetchedTitle) === normTargetTitle) {
          showCover(imgUrl.replace('http://', 'https://'));
          return;
        }
      }
    } catch (e) { /* ignore & fallback */ }

    try {
      const res = await fetch(`https://openlibrary.org/search.json?q=${query}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        const doc = data.docs?.[0];
        const fetchedTitle = doc?.title || '';
        const coverId = doc?.cover_i;

        if (coverId && normalizeTitle(fetchedTitle) === normTargetTitle) {
          showCover(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg`);
          return;
        }
      }
    } catch (e) { /* ignore & fallback */ }

    hideCover();
  }

  function triggerCoverFetch() {
    clearTimeout(coverDebounce);
    coverDebounce = setTimeout(() => {
      fetchBookCover(metaTitle, metaAuthor);
    }, 500);
  }

  function defaultCategoryState(genreKey){
    const s = {};
    GENRES[genreKey].categories.forEach(c => {
      s[c.id] = c.choices ? c.choices[2].value : 2.5;
    });
    return s;
  }

  const allState = {};
  GENRE_ORDER.forEach(g => allState[g] = defaultCategoryState(g));
  let currentGenre = 'fiction';

  function buildVector(){
    const cats = GENRES[currentGenre].categories;
    const state = allState[currentGenre];
    const parts = ['BR:1.1'];
    
    if(metaTitle.trim()) parts.push('T:' + encodeURIComponent(metaTitle.trim()));
    if(metaAuthor.trim()) parts.push('A:' + encodeURIComponent(metaAuthor.trim()));
    if(selectedScalePrecision !== 0.25) parts.push('SP:' + selectedScalePrecision);
    
    parts.push('G:' + currentGenre);
    cats.forEach(c => parts.push(c.id + ':' + (state[c.id] === null ? 'NA' : state[c.id])));
    return parts.join('/');
  }

  function parseVector(v){
    if(!v) return;
    const map = {};
    v.split('/').forEach(part => {
      const idx = part.indexOf(':');
      if(idx === -1) return;
      map[part.slice(0, idx)] = part.slice(idx + 1);
    });

    if(map.T) {
      metaTitle = decodeURIComponent(map.T);
      document.getElementById('bookTitle').value = metaTitle;
    }
    if(map.A) {
      metaAuthor = decodeURIComponent(map.A);
      document.getElementById('bookAuthor').value = metaAuthor;
    }

    if(map.SP) {
      const sp = parseFloat(map.SP);
      if([0.25, 0.5, 1.0].includes(sp)) selectedScalePrecision = sp;
    }

    if(metaTitle) {
      fetchBookCover(metaTitle, metaAuthor);
    }

    if(map.G && GENRES[map.G]) currentGenre = map.G;
    const cats = GENRES[currentGenre].categories;
    const state = allState[currentGenre];
    cats.forEach(c => {
      const raw = map[c.id];
      if(raw === undefined) return;
      if(raw === 'NA'){ if(c.allowNA) state[c.id] = null; return; }
      const num = parseFloat(raw);
      if(!isNaN(num) && num >= 0 && num <= 5) state[c.id] = Math.round(num * 100) / 100;
    });
  }

  function compute(){
    const cats = GENRES[currentGenre].categories;
    const state = allState[currentGenre];
    let sum = 0, totalWeight = 0;
    cats.forEach(cat => {
      const val = state[cat.id];
      if(val === null || val === undefined) return;
      sum += val * cat.weight;
      totalWeight += cat.weight;
    });
    let base = totalWeight > 0 ? sum / totalWeight : 0;
    
    if (selectedScalePrecision === 0.5) {
      base = Math.round(base * 2) / 2;
    } else if (selectedScalePrecision === 1.0) {
      base = Math.round(base);
    } else {
      base = Math.round(base * 4) / 4;
    }
    
    base = Math.min(5, Math.max(0, base));
    return { base, final: base };
  }

  function verdictFor(final){
    if(final <= 0.75) return { text:'Should have been a DNF', recommend:false };
    if(final <= 1.5) return { text:'Very bad, very few good points', recommend:false };
    if(final <= 2.25) return { text:'Below average, more bad than good', recommend:false };
    if(final < 3.50) return { text:'Average, just okay', recommend:false };
    if(final <= 4.25) return { text:'Good, would recommend', recommend:true };
    if(final <= 4.75) return { text:'Excellent', recommend:true };
    return { text:'Perfect', recommend:true };
  }

  const genresEl = document.getElementById('genres');
  GENRE_ORDER.forEach(key => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre';
    btn.textContent = GENRES[key].label;
    btn.dataset.genre = key;
    btn.addEventListener('click', () => {
      currentGenre = key;
      renderCriteria();
      render();
      syncGenreButtons();
    });
    genresEl.appendChild(btn);
  });

  function syncGenreButtons(){
    document.querySelectorAll('.genre').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.genre === currentGenre);
    });
  }

  const criteriaEl = document.getElementById('criteria');

  function renderCriteria(){
    criteriaEl.innerHTML = '';
    const cats = GENRES[currentGenre].categories;

    cats.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'row';

      const head = document.createElement('div');
      head.className = 'row-head';
      head.innerHTML = '<span class="row-title">' + cat.title + '</span>' +
                        '<span class="row-leader"></span>' +
                        '<span class="row-weight">' + Math.round(cat.weight * 100) + '%</span>';
      row.appendChild(head);

      if(cat.question){
        const q = document.createElement('div');
        q.className = 'row-question';
        q.textContent = cat.question;
        row.appendChild(q);
      }

      const scaleEl = document.createElement('div');
      scaleEl.className = 'scale';
      scaleEl.setAttribute('role', 'group');
      scaleEl.setAttribute('aria-label', cat.title + ' score selection');

      if(cat.choices){
        cat.choices.forEach(ch => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tier';
          btn.textContent = ch.label;
          btn.dataset.cat = cat.id;
          btn.dataset.value = ch.value;
          btn.addEventListener('click', () => {
            allState[currentGenre][cat.id] = ch.value;
            render();
          });
          scaleEl.appendChild(btn);
        });
      } else {
        SCALE.forEach(v => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tier';
          btn.textContent = String(v);
          btn.dataset.cat = cat.id;
          btn.dataset.value = v;
          btn.addEventListener('click', () => {
            allState[currentGenre][cat.id] = v;
            render();
          });
          scaleEl.appendChild(btn);
        });

        if(cat.allowNA){
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tier na';
          btn.textContent = 'N/A';
          btn.dataset.cat = cat.id;
          btn.dataset.value = 'na';
          btn.addEventListener('click', () => {
            allState[currentGenre][cat.id] = null;
            render();
          });
          scaleEl.appendChild(btn);
        }
      }

      row.appendChild(scaleEl);

      const feel = document.createElement('div');
      feel.className = 'score-feel';
      feel.setAttribute('aria-live', 'polite');
      row.appendChild(feel);
      row._scoreFeel = feel;

      if(cat.lowLabel || cat.highLabel){
        const labels = document.createElement('div');
        labels.className = 'scale-labels';
        labels.innerHTML = '<span>' + (cat.lowLabel || '') + '</span><span>' + (cat.highLabel || '') + '</span>';
        row.appendChild(labels);
      }

      criteriaEl.appendChild(row);
    });
  }

  document.getElementById('bookTitle').addEventListener('input', (e) => {
    metaTitle = e.target.value;
    triggerCoverFetch();
    render();
  });

  document.getElementById('bookAuthor').addEventListener('input', (e) => {
    metaAuthor = e.target.value;
    triggerCoverFetch();
    render();
  });

  document.querySelectorAll('.precision-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedScalePrecision = parseFloat(btn.dataset.scale);
      render();
    });
  });

  const starsFront = document.getElementById('starsFront');
  const scoreNum = document.getElementById('scoreNum');
  const verdictEl = document.getElementById('verdict');
  const recBadge = document.getElementById('recBadge');
  const vectorStr = document.getElementById('vectorStr');

  document.getElementById('copyVector').addEventListener('click', (e) => {
    copyText(vectorStr.textContent, e.target);
  });
  document.getElementById('copyLink').addEventListener('click', (e) => {
    copyText(location.href, e.target, 'Copy shareable link', 'Link copied!');
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    allState[currentGenre] = defaultCategoryState(currentGenre);
    metaTitle = '';
    metaAuthor = '';
    selectedScalePrecision = 0.25;
    document.getElementById('bookTitle').value = '';
    document.getElementById('bookAuthor').value = '';
    hideCover();
    render();
  });

  function copyText(text, btn, restLabel, doneLabel){
    const original = btn.textContent;
    const done = doneLabel || 'Copied';
    const rest = restLabel || original;

    const applySuccess = () => {
      btn.textContent = done;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = rest;
        btn.classList.remove('copied');
      }, 1400);
    };

    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(applySuccess).catch(applySuccess);
    } else {
      applySuccess();
    }
  }

  function scoreFeeling(v, cat){
    if(cat.choices){
      const match = cat.choices.find(c => Math.abs(c.value - v) < 0.01);
      return match ? match.feel : '';
    }
    if(cat.feels && cat.feels[v] !== undefined){
      return cat.feels[v];
    }
    return '';
  }

  function render(){
    document.body.className = 'genre-' + currentGenre;
    const state = allState[currentGenre];

    document.querySelectorAll('.tier').forEach(btn => {
      const catId = btn.dataset.cat;
      const val = state[catId];
      if(btn.dataset.value === 'na'){
        btn.classList.toggle('active', val === null);
      } else {
        const btnVal = parseFloat(btn.dataset.value);
        btn.classList.toggle('active', Math.abs(val - btnVal) < 0.01);
      }
    });

    document.querySelectorAll('.precision-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.scale) === selectedScalePrecision);
    });

    document.querySelectorAll('.row').forEach((row, i) => {
      const cat = GENRES[currentGenre].categories[i];
      const feel = row._scoreFeel;
      const val = state[cat.id];
      if(feel){
        feel.textContent = val === null ? 'Not applicable to this book.' : scoreFeeling(val, cat);
      }
    });

    const { final } = compute();

    starsFront.style.width = ((final / 5) * 100) + '%';
    scoreNum.innerHTML = (selectedScalePrecision === 1.0 ? final.toFixed(1) : final.toFixed(2)) + '<span>/5</span>';

    const v = verdictFor(final);
    verdictEl.textContent = v.text;
    recBadge.textContent = v.recommend ? 'Clears your recommend line' : 'Below your recommend line';
    recBadge.classList.toggle('recommend', v.recommend);
    recBadge.classList.add('pulse');
    setTimeout(() => recBadge.classList.remove('pulse'), 180);

    const vector = buildVector();
    vectorStr.textContent = vector;

    const newUrl = location.pathname + '?v=' + vector;
    history.replaceState(null, '', newUrl);
  }

  parseVector(new URLSearchParams(location.search).get('v'));
  renderCriteria();
  syncGenreButtons();
  render();
})();
