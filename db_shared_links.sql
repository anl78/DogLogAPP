-- 1. Tabla para los enlaces compartidos
CREATE TABLE IF NOT EXISTS public.shared_links (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pet_id uuid REFERENCES public.pets(id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- 2. RLS para la tabla shared_links
ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;

-- Dueños y colaboradores pueden ver, crear y borrar enlaces de las mascotas a las que tienen acceso
CREATE POLICY "Users can manage shared links for their pets" ON public.shared_links
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.pets WHERE id = shared_links.pet_id AND owner_id = auth.uid()
    ) OR
    EXISTS (
        SELECT 1 FROM public.pet_collaborators WHERE pet_id = shared_links.pet_id AND user_id = auth.uid()
    )
);

-- 3. Función RPC para obtener datos de la mascota con el token (Bypass RLS seguro)
CREATE OR REPLACE FUNCTION get_shared_pet_data(p_token uuid)
RETURNS json AS $$
DECLARE
    v_pet_id uuid;
    v_expires_at timestamptz;
    v_pet_data json;
    v_events_data json;
BEGIN
    -- Verificar validez del token
    SELECT pet_id, expires_at INTO v_pet_id, v_expires_at
    FROM public.shared_links
    WHERE id = p_token;

    IF v_pet_id IS NULL THEN
        RAISE EXCEPTION 'Enlace no válido o no encontrado';
    END IF;

    IF v_expires_at < now() THEN
        RAISE EXCEPTION 'Este enlace ha caducado';
    END IF;

    -- Obtener datos de la mascota
    SELECT row_to_json(p) INTO v_pet_data
    FROM public.pets p
    WHERE id = v_pet_id;

    -- Obtener últimos 100 eventos
    SELECT json_agg(row_to_json(e)) INTO v_events_data
    FROM (
        SELECT * FROM public.events
        WHERE pet_id = v_pet_id
        ORDER BY date DESC, time DESC
        LIMIT 100
    ) e;

    RETURN json_build_object(
        'pet', v_pet_data,
        'events', COALESCE(v_events_data, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
