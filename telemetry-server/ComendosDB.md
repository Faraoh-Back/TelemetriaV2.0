-- 1. Cria a tabela normal
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ       NOT NULL,
    signal_name TEXT              NOT NULL,
    value       DOUBLE PRECISION  NULL,
    unit        TEXT              NULL,
    can_id      INTEGER           NULL
);

-- 2. A MÁGICA ACONTECE AQUI: Transforma em Hypertable
-- O TimescaleDB vai picotar os dados em pedaços de tempo automaticamente
SELECT create_hypertable('sensor_data', 'time');

-- 3. Cria índice para busca rápida pelo nome do sensor
CREATE INDEX idx_sensor_time ON sensor_data (signal_name, time DESC);