import { useState, useRef, useEffect } from 'react';
import { Button } from '@/shared/components/Button';
import { testAiAssistant, type AiTestMessage } from '../services/aiConfig.service';

interface AiTestChatProps {
  companyId:     string;
  /** Prompt y base de conocimiento ACTUALES del editor (aunque no se hayan guardado). */
  basePrompt:    string;
  knowledgeBase: string;
}

/**
 * Chat de prueba del asistente: escribe como si fueras un cliente y ve cómo
 * responde la IA con el prompt de arriba (incluso sin guardar). No manda WhatsApp
 * ni guarda nada — es solo para probar tono y respuestas.
 */
export function AiTestChat({ companyId, basePrompt, knowledgeBase }: AiTestChatProps) {
  const [messages, setMessages] = useState<AiTestMessage[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: AiTestMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError(null);
    setLoading(true);
    try {
      const reply = await testAiAssistant(companyId, next, { basePrompt, knowledgeBase });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la respuesta.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Probar el asistente</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Escribe como un cliente y mira cómo responde con el prompt de arriba (aunque no lo hayas guardado). No manda WhatsApp.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => { setMessages([]); setError(null); }}
            className="shrink-0 text-[11px] text-zinc-500 underline transition-colors hover:text-zinc-300"
          >
            Reiniciar
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-900/40">
        {/* Conversación */}
        <div ref={scrollRef} className="flex max-h-96 min-h-40 flex-col gap-2.5 overflow-y-auto p-4">
          {messages.length === 0 && !loading && (
            <p className="m-auto max-w-xs text-center text-xs text-zinc-600">
              Empieza escribiendo algo como “Hola, quiero información de los terrenos” para ver la respuesta de la IA.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'self-end rounded-br-sm bg-violet-600 text-white'
                  : 'self-start rounded-bl-sm bg-zinc-800 text-zinc-100'
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="self-start rounded-2xl rounded-bl-sm bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-400">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
              </span>
            </div>
          )}
        </div>

        {/* Entrada */}
        <div className="flex items-end gap-2 border-t border-zinc-800 bg-zinc-900/60 p-2.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Escribe un mensaje de prueba…  (Enter para enviar)"
            className="max-h-32 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-violet-500/50 focus:outline-none"
          />
          <Button onClick={() => void send()} disabled={!input.trim() || loading} loading={loading} size="md">
            Enviar
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
      )}
    </section>
  );
}
