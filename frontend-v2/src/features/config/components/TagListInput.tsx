import { useState, type KeyboardEvent } from 'react';

interface TagListInputProps {
  value:       string[];
  onChange:    (tags: string[]) => void;
  placeholder?: string;
}

/**
 * Input que permite agregar/quitar strings como chips.
 * Enter o coma para agregar, click en la ✕ para quitar.
 */
export function TagListInput({ value, onChange, placeholder = 'Escribe y presiona Enter' }: TagListInputProps) {
  const [input, setInput] = useState('');

  const add = () => {
    const tag = input.trim().replace(/,$/, '');
    if (!tag || value.includes(tag)) {
      setInput('');
      return;
    }
    onChange([...value, tag]);
    setInput('');
  };

  const remove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 focus-within:border-violet-500/50 transition-colors min-h-[42px]">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-xs bg-zinc-700 text-zinc-200 rounded-full px-2.5 py-1"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-zinc-400 hover:text-red-400 transition-colors leading-none"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
      />
    </div>
  );
}
