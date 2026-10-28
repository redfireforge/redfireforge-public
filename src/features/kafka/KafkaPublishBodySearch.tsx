import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { SearchMatchBar } from '@shared/components/SearchMatchBar';
import { findTextMatches, type TextMatch } from './kafkaBodyTextSearch';

interface BodySearchApi {
  query: string;
  matches: TextMatch[];
  safeIndex: number;
  highlighted: ReactNode;
  shellRef: RefObject<HTMLDivElement | null>;
  changeQuery: (value: string) => void;
  go: (delta: number) => void;
}

const BodySearchContext = createContext<BodySearchApi | null>(null);

function useBodySearchApi(): BodySearchApi {
  const api = useContext(BodySearchContext);
  if (!api) {
    throw new Error('Message body search controls must render inside KafkaPublishBodySearch');
  }
  return api;
}

interface KafkaPublishBodySearchProps {
  text: string;
  children: ReactNode;
}

export function KafkaPublishBodySearch({ text, children }: KafkaPublishBodySearchProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const currentHitRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [revealToken, setRevealToken] = useState(0);
  const matches = useMemo(() => findTextMatches(text, query), [text, query]);
  const safeIndex = matches.length === 0 ? 0 : index % matches.length;

  useEffect(() => {
    if (revealToken === 0) return;
    const shell = shellRef.current;
    const hit = currentHitRef.current;
    if (!shell || !hit) return;
    const shellRect = shell.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    if (shellRect.height <= 0 || hitRect.height <= 0) return;
    const deltaY = hitRect.top - shellRect.top - (shellRect.height - hitRect.height) / 2;
    shell.scrollTop += deltaY;
  }, [revealToken]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setIndex(0);
    setRevealToken((token) => token + 1);
  };

  const go = (delta: number) => {
    if (matches.length === 0) return;
    setIndex((current) => (current + delta + matches.length) % matches.length);
    setRevealToken((token) => token + 1);
  };

  const highlighted: ReactNode = useMemo(() => {
    if (matches.length === 0) return text;
    const parts: ReactNode[] = [];
    let cursor = 0;
    matches.forEach((hit, hitIndex) => {
      if (hit.start > cursor) parts.push(text.slice(cursor, hit.start));
      const current = hitIndex === safeIndex;
      parts.push(
        <mark
          key={`${hit.start}-${hit.end}`}
          ref={current ? currentHitRef : undefined}
          className={`kafka-ms-search-hit${current ? ' is-current' : ''}`}
          data-testid={current ? 'pub-body-search-current' : undefined}
        >
          {text.slice(hit.start, hit.end)}
        </mark>,
      );
      cursor = hit.end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  }, [matches, safeIndex, text]);

  const api: BodySearchApi = {
    query,
    matches,
    safeIndex,
    highlighted,
    shellRef,
    changeQuery,
    go,
  };

  const content = isValidElement(children)
    ? (
      <>
        <KafkaPublishBodySearchBar />
        <KafkaPublishBodySearchEditor>{children}</KafkaPublishBodySearchEditor>
      </>
    )
    : children;

  return <BodySearchContext.Provider value={api}>{content}</BodySearchContext.Provider>;
}

/** Search field for the Message Body header, between the title and Expand. */
export function KafkaPublishBodySearchBar() {
  const { query, matches, safeIndex, changeQuery, go } = useBodySearchApi();
  return (
    <SearchMatchBar
      value={query}
      onChange={changeQuery}
      currentMatch={matches.length > 0 ? safeIndex + 1 : 0}
      totalMatches={matches.length}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
      onClear={() => changeQuery('')}
      placeholder="Search body…"
      ariaLabel="Search message body"
      className="kafka-ms-body-search"
      inputClassName="kafka-ms-body-search-input"
      countClassName="kafka-ms-body-search-count"
      navClassName="kafka-ms-body-search-nav"
      clearClassName="kafka-ms-body-search-clear"
      inputTestId="pub-body-search"
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || matches.length === 0) return;
        event.preventDefault();
        go(event.shiftKey ? -1 : 1);
      }}
    />
  );
}

export function KafkaPublishBodySearchEditor({
  children,
}: {
  children: ReactElement;
}) {
  const { matches, highlighted, shellRef } = useBodySearchApi();
  return (
    <div
      ref={shellRef}
      className={`kafka-ms-body-shell${matches.length > 0 ? ' is-searching' : ''}`}
      data-testid="pub-body-shell"
    >
      <div className="kafka-ms-body-content">
        <pre className="kafka-ms-body-highlight" aria-hidden="true">
          {highlighted}
        </pre>
        {children}
      </div>
    </div>
  );
}
