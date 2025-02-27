import { createAction, createErrorAction, ThunkAction } from '@bigcommerce/data-store';
import { filter } from 'lodash';
import { Observable, Observer } from 'rxjs';

import { InternalCheckoutSelectors } from '../checkout';
import { cachableAction, ActionOptions } from '../common/data-store';
import { RequestOptions } from '../common/http-request';

import { PaymentMethod } from '.';
import { LoadPaymentMethodsAction, LoadPaymentMethodAction, PaymentMethodActionType } from './payment-method-actions';
import PaymentMethodRequestSender from './payment-method-request-sender';
import { isApplePayWindow } from './strategies/apple-pay';

const APPLEPAYID = 'applepay';

export default class PaymentMethodActionCreator {
    constructor(
        private _requestSender: PaymentMethodRequestSender
    ) {}

    loadPaymentMethods(options?: RequestOptions): ThunkAction<LoadPaymentMethodsAction, InternalCheckoutSelectors> {
        return store => Observable.create((observer: Observer<LoadPaymentMethodsAction>) => {
            const state = store.getState();
            const cart = state.cart.getCartOrThrow();

            observer.next(createAction(PaymentMethodActionType.LoadPaymentMethodsRequested));

            this._requestSender.loadPaymentMethods({ ...options, params: { ...options?.params, cartId: cart.id } })
                .then(response => {
                    const meta = {
                        deviceSessionId: response.headers['x-device-session-id'],
                        sessionHash: response.headers['x-session-hash'],
                    };
                    const methods = response.body;
                    const filteredMethods = Array.isArray(methods) ? this._filterApplePay(methods) : methods;

                    observer.next(createAction(PaymentMethodActionType.LoadPaymentMethodsSucceeded, filteredMethods, meta));
                    observer.complete();
                })
                .catch(response => {
                    observer.error(createErrorAction(PaymentMethodActionType.LoadPaymentMethodsFailed, response));
                });
        });
    }

    @cachableAction
    loadPaymentMethod(methodId: string, options?: RequestOptions & ActionOptions): ThunkAction<LoadPaymentMethodAction, InternalCheckoutSelectors> {
        return store => Observable.create((observer: Observer<LoadPaymentMethodAction>) => {
            const state = store.getState();
            const cartId = state.cart.getCart()?.id;
            const params = cartId ? { ...options?.params, cartId } : { ...options?.params };

            observer.next(createAction(PaymentMethodActionType.LoadPaymentMethodRequested, undefined, { methodId }));

            this._requestSender.loadPaymentMethod(methodId, { ...options, params })
                .then(response => {
                    observer.next(createAction(PaymentMethodActionType.LoadPaymentMethodSucceeded, response.body, { methodId }));
                    observer.complete();
                })
                .catch(response => {
                    observer.error(createErrorAction(PaymentMethodActionType.LoadPaymentMethodFailed, response, { methodId }));
                });
        });
    }

    private _filterApplePay(methods: PaymentMethod[]): PaymentMethod[] {

        return filter(methods, method => {
            if (method.id === APPLEPAYID && !isApplePayWindow(window)) {
                return false;
            }

            return true;
        });
    }
}
