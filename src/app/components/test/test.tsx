'use client';

import { useState, useEffect } from 'react';

export default function Test() {
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        fetch('/api/test')
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                return res.json();
            })
            .then(data => setData(data))
            .catch(err => {
                console.error('Error fetching data:', err);
                setError(err.message);
            });
    }, []);
    
    if (error) {
        return <div>Error: {error}</div>;
    }
    
    return <div>{data?.message || 'Loading...'}</div>;
}