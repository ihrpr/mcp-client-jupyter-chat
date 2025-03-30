import React, { useState, useEffect, useRef } from 'react';
import { ITokenUsage } from '../types';
import { icons, createSvgIcon } from '../utils';

interface ITokenUsageProps {
  tokenUsage: ITokenUsage;
}

export const TokenUsage = ({ tokenUsage }: ITokenUsageProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const totalInputTokens = tokenUsage.input_tokens;
  const totalOutputTokens = tokenUsage.output_tokens;
  const cacheCreationTokens = tokenUsage.cache_creation_input_tokens;
  const cacheReadTokens = tokenUsage.cache_read_input_tokens;

  // Calculate cache usage percentage
  const cacheUsagePercent =
    totalInputTokens > 0
      ? Math.round((cacheReadTokens / totalInputTokens) * 100)
      : 0;

  // Hide popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        buttonRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Auto-hide after 4 seconds when shown automatically
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isVisible) {
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 4000);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isVisible]);

  return (
    <>
      <div
        ref={buttonRef}
        className="mcp-toolbar-button mcp-token-usage-button"
        onClick={() => setIsVisible(!isVisible)}
        dangerouslySetInnerHTML={{
          __html: createSvgIcon(icons.tokenUsage) + ' Token Usage'
        }}
      />

      <div
        ref={popupRef}
        className={`mcp-token-usage-popup ${isVisible ? 'show' : ''}`}
      >
        <div className="mcp-token-usage-header">Token Usage</div>
        <div className="mcp-token-usage-content">
          <div className="mcp-token-usage-item">Input: {totalInputTokens}</div>
          <div className="mcp-token-usage-item">
            Output: {totalOutputTokens}
          </div>
          <div className="mcp-token-usage-item">
            Cache Creation: {cacheCreationTokens}
          </div>
          <div className="mcp-token-usage-item">
            Cache Read: {cacheReadTokens}
          </div>
          <div className="mcp-token-usage-item">
            Cache Usage: {cacheUsagePercent}%
          </div>
        </div>
      </div>
    </>
  );
};
