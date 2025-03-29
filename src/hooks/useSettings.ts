import { useState, useEffect } from 'react';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IModelConfig, ISettings } from '../types';

/**
 * Hook for managing extension settings
 */
export const useSettings = (
  settingRegistry: ISettingRegistry | null,
  pluginId: string
) => {
  const [settings, setSettings] = useState<ISettings | null>(null);
  const [availableModels, setAvailableModels] = useState<IModelConfig[]>([]);
  const [selectedModel, setSelectedModel] = useState<IModelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      if (!settingRegistry) {
        setIsLoading(false);
        return;
      }

      try {
        const settings = await settingRegistry.load(pluginId);

        // Setup initial settings
        handleSettingsChange(settings);

        // Watch for changes
        settings.changed.connect(handleSettingsChange);

        // Cleanup
        return () => {
          settings.changed.disconnect(handleSettingsChange);
        };
      } catch (err) {
        console.error('Failed to load settings:', err);
        setError('Failed to load settings');
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [settingRegistry, pluginId]);

  const handleSettingsChange = (settings: ISettingRegistry.ISettings) => {
    try {
      const settingsData = settings.composite as unknown as ISettings;
      setSettings(settingsData);

      // Update models
      const models = settingsData?.models || [];
      const modelList = Array.isArray(models) ? models : [];
      setAvailableModels(modelList);

      // Select default model
      const defaultModel =
        modelList.find(m => m.isDefault) || modelList[0] || null;
      setSelectedModel(defaultModel);

      setError(null);
    } catch (err) {
      console.error('Error processing settings:', err);
      setError('Error processing settings');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    settings,
    availableModels,
    selectedModel,
    setSelectedModel,
    isLoading,
    error
  };
};
