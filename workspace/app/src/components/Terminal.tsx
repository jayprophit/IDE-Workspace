import React, { useState, useEffect, useRef } from 'react';

interface TerminalProps {
  sessionId?: string;
  onCommand?: (command: string) => void;
  onOutput?: (output: string) => void;
}

interface TerminalLine {
  type: 'input' | 'output' | 'error';
  content: string;
  timestamp: Date;
}

export const Terminal: React.FC<TerminalProps> = ({
  sessionId,
  onCommand,
  onOutput
}) => {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Add welcome message
    setLines([{
      type: 'output',
      content: 'Aetherius IDE Terminal v1.0.0',
      timestamp: new Date()
    }, {
      type: 'output',
      content: 'Type "help" for available commands.',
      timestamp: new Date()
    }]);
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const addLine = (type: 'input' | 'output' | 'error', content: string) => {
    setLines(prev => [...prev, { type, content, timestamp: new Date() }]);
  };

  const processCommand = async (command: string) => {
    // Add input line
    addLine('input', `$ ${command}`);

    // Add to history
    if (command.trim()) {
      setHistory(prev => [...prev, command]);
    }
    setHistoryIndex(-1);

    // Process command
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        addLine('output', `Available commands:
  help          Show this help message
  clear         Clear terminal
  echo          Echo text to output
  ls            List directory contents
  cd            Change directory
  pwd           Print working directory
  cat           Display file contents
  mkdir         Create directory
  touch         Create file
  rm            Remove file or directory
  history       Show command history
  version       Show terminal version`);
        break;

      case 'clear':
        setLines([]);
        break;

      case 'echo':
        addLine('output', args.join(' '));
        break;

      case 'ls':
        addLine('output', `src/
package.json
README.md
node_modules/`);
        break;

      case 'pwd':
        addLine('output', 'C:\\Users\\jpowe\\Desktop\\Projects\\IDE-Workspace\\workspace\\app');
        break;

      case 'cat':
        if (args.length === 0) {
          addLine('error', 'cat: missing file operand');
        } else {
          addLine('output', `// File: ${args[0]}
// Content would be loaded from Agent Bridge API`);
        }
        break;

      case 'history':
        history.forEach((cmd, i) => {
          addLine('output', `  ${i + 1}  ${cmd}`);
        });
        break;

      case 'version':
        addLine('output', 'Aetherius IDE Terminal v1.0.0');
        break;

      default:
        if (cmd) {
          // Try to execute via Agent Bridge API
          addLine('output', `Executing: ${command}`);
          setIsRunning(true);

          // Simulate command execution
          setTimeout(() => {
            addLine('output', `Command completed: ${command}`);
            setIsRunning(false);
          }, 1000);
        }
        break;
    }

    onCommand?.(command);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      processCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      className="h-full bg-gray-900 text-green-400 font-mono text-sm flex flex-col"
      onClick={focusInput}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-white font-semibold">Terminal</span>
        <div className="flex items-center gap-2">
          {sessionId && (
            <span className="text-xs text-gray-400">Session: {sessionId.substring(0, 8)}</span>
          )}
          {isRunning && (
            <span className="text-yellow-400 text-xs">Running...</span>
          )}
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto p-4"
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className={`whitespace-pre-wrap ${
              line.type === 'input' ? 'text-white' :
              line.type === 'error' ? 'text-red-400' :
              'text-green-400'
            }`}
          >
            {line.content}
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="flex items-center px-4 py-2 border-t border-gray-700">
        <span className="text-green-400 mr-2">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-white outline-none"
          placeholder="Type a command..."
          autoFocus
        />
      </div>
    </div>
  );
};

export default Terminal;