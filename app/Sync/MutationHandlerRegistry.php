<?php

namespace App\Sync;

use App\Sync\Handlers\{OrderCreateHandler, OrderRefundHandler, OrderVoidHandler, PaymentAddHandler, SessionEndHandler, StockAdjustHandler, StockCountHandler};
use Illuminate\Contracts\Container\Container;

class MutationHandlerRegistry
{
    private const HANDLERS = [
        'order.create' => OrderCreateHandler::class,
        'order.void'   => OrderVoidHandler::class,
        'payment.add'  => PaymentAddHandler::class,
        'stock.adjust' => StockAdjustHandler::class,
        'session.end'  => SessionEndHandler::class,
        'order.refund' => OrderRefundHandler::class,
        'stock.count'  => StockCountHandler::class,
    ];

    public function __construct(private Container $container) {}

    public function for(string $type): MutationHandler
    {
        $class = self::HANDLERS[$type] ?? throw new MutationRejected('unknown_type', ['type' => $type]);

        return $this->container->make($class);
    }
}
