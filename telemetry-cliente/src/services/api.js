import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// URL da API (IP fixo do servidor)
const API_URL = 'http://192.168.1.1:5000/api';

// Criar instância do axios
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para adicionar token em todas as requisições
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Funções da API
export const login = async (email, password) => {
  try {
    const response = await api.post('/login', { email, password });
    const { token, user } = response.data;
    
    // Salvar token localmente
    await AsyncStorage.setItem('userToken', token);
    await AsyncStorage.setItem('userData', JSON.stringify(user));
    
    return { success: true, token, user };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Erro ao fazer login',
    };
  }
};

export const logout = async () => {
  await AsyncStorage.removeItem('userToken');
  await AsyncStorage.removeItem('userData');
};

export const getLatestTelemetry = async (limit = 50) => {
  try {
    const response = await api.get(`/telemetry/latest?limit=${limit}`);
    return { success: true, data: response.data.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Erro ao buscar dados',
    };
  }
};

export const getTelemetryBySignal = async (signalName) => {
  try {
    const response = await api.get(`/telemetry?signal_name=${signalName}&limit=100`);
    return { success: true, data: response.data.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Erro ao buscar dados',
    };
  }
};

export const getAvailableSignals = async () => {
  try {
    const response = await api.get('/telemetry/signals');
    return { success: true, signals: response.data.signals };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Erro ao buscar sinais',
    };
  }
};

export const checkHealth = async () => {
  try {
    const response = await api.get('/health');
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, message: 'API offline' };
  }
};

export default api;